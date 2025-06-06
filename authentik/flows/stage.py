"""authentik stage Base view"""

from typing import TYPE_CHECKING

from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.http import HttpRequest
from django.http.request import QueryDict
from django.http.response import HttpResponse
from django.urls import reverse
from django.views.generic.base import View
from prometheus_client import Histogram
from rest_framework.request import Request
from sentry_sdk import start_span
from structlog.stdlib import BoundLogger, get_logger

from authentik.core.models import Application, User
from authentik.flows.challenge import (
    AccessDeniedChallenge,
    Challenge,
    ChallengeResponse,
    ContextualFlowInfo,
    HttpChallengeResponse,
    RedirectChallenge,
    SessionEndChallenge,
    WithUserInfoChallenge,
)
from authentik.flows.exceptions import StageInvalidException
from authentik.flows.models import InvalidResponseAction
from authentik.flows.planner import PLAN_CONTEXT_APPLICATION, PLAN_CONTEXT_PENDING_USER
from authentik.lib.avatars import DEFAULT_AVATAR, get_avatar
from authentik.lib.utils.reflection import class_to_path

if TYPE_CHECKING:
    from authentik.flows.views.executor import FlowExecutorView

PLAN_CONTEXT_PENDING_USER_IDENTIFIER = "pending_user_identifier"
HIST_FLOWS_STAGE_TIME = Histogram(
    "authentik_flows_stage_time",
    "Duration taken by different parts of stages",
    ["stage_type", "method"],
)


class StageView(View):
    """Abstract Stage"""

    executor: "FlowExecutorView"

    request: HttpRequest = None

    logger: BoundLogger

    def __init__(self, executor: "FlowExecutorView", **kwargs):
        self.executor = executor
        current_stage = getattr(self.executor, "current_stage", None)
        self.logger = get_logger().bind(
            stage=getattr(current_stage, "name", None),
            stage_view=class_to_path(type(self)),
        )
        super().__init__(**kwargs)

    def get_pending_user(self, for_display=False) -> User:
        """Either show the matched User object or show what the user entered,
        based on what the earlier stage (mostly IdentificationStage) set.
        _USER_IDENTIFIER overrides the first User, as PENDING_USER is used for
        other things besides the form display.

        If no user is pending, returns request.user"""
        if not self.executor.plan:
            return self.request.user
        if PLAN_CONTEXT_PENDING_USER_IDENTIFIER in self.executor.plan.context and for_display:
            return User(
                username=self.executor.plan.context.get(PLAN_CONTEXT_PENDING_USER_IDENTIFIER),
                email="",
            )
        if PLAN_CONTEXT_PENDING_USER in self.executor.plan.context:
            return self.executor.plan.context[PLAN_CONTEXT_PENDING_USER]
        return self.request.user

    def cleanup(self):
        """Cleanup session"""


class ChallengeStageView(StageView):
    """Stage view which response with a challenge"""

    response_class = ChallengeResponse

    def get_response_instance(self, data: QueryDict) -> ChallengeResponse:
        """Return the response class type"""
        return self.response_class(None, data=data, stage=self)

    def get(self, request: HttpRequest, *args, **kwargs) -> HttpResponse:
        """Return a challenge for the frontend to solve"""
        try:
            challenge = self._get_challenge(*args, **kwargs)
        except StageInvalidException as exc:
            self.logger.debug("Got StageInvalidException", exc=exc)
            return self.executor.stage_invalid()
        if not challenge.is_valid():
            self.logger.error(
                "f(ch): Invalid challenge",
                errors=challenge.errors,
                challenge=challenge.data,
            )
        return HttpChallengeResponse(challenge)

    def post(self, request: Request, *args, **kwargs) -> HttpResponse:
        """Handle challenge response"""
        valid = False
        try:
            challenge: ChallengeResponse = self.get_response_instance(data=request.data)
            valid = challenge.is_valid()
        except StageInvalidException as exc:
            self.logger.debug("Got StageInvalidException", exc=exc)
            return self.executor.stage_invalid()
        if not valid:
            if self.executor.current_binding.invalid_response_action in [
                InvalidResponseAction.RESTART,
                InvalidResponseAction.RESTART_WITH_CONTEXT,
            ]:
                keep_context = (
                    self.executor.current_binding.invalid_response_action
                    == InvalidResponseAction.RESTART_WITH_CONTEXT
                )
                self.logger.debug(
                    "f(ch): Invalid response, restarting flow",
                    keep_context=keep_context,
                )
                return self.executor.restart_flow(keep_context)
            with (
                start_span(
                    op="authentik.flow.stage.challenge_invalid",
                    name=self.__class__.__name__,
                ),
                HIST_FLOWS_STAGE_TIME.labels(
                    stage_type=self.__class__.__name__, method="challenge_invalid"
                ).time(),
            ):
                return self.challenge_invalid(challenge)
        with (
            start_span(
                op="authentik.flow.stage.challenge_valid",
                name=self.__class__.__name__,
            ),
            HIST_FLOWS_STAGE_TIME.labels(
                stage_type=self.__class__.__name__, method="challenge_valid"
            ).time(),
        ):
            return self.challenge_valid(challenge)

    def format_title(self) -> str:
        """Allow usage of placeholder in flow title."""
        if not self.executor.plan:
            return self.executor.flow.title
        try:
            return self.executor.flow.title % {
                "app": self.executor.plan.context.get(PLAN_CONTEXT_APPLICATION, ""),
                "user": self.get_pending_user(for_display=True),
            }

        except Exception as exc:
            self.logger.warning("failed to template title", exc=exc)
            return self.executor.flow.title

    def _get_challenge(self, *args, **kwargs) -> Challenge:
        with (
            start_span(
                op="authentik.flow.stage.get_challenge",
                name=self.__class__.__name__,
            ),
            HIST_FLOWS_STAGE_TIME.labels(
                stage_type=self.__class__.__name__, method="get_challenge"
            ).time(),
        ):
            challenge = self.get_challenge(*args, **kwargs)
        with start_span(
            op="authentik.flow.stage._get_challenge",
            name=self.__class__.__name__,
        ):
            if not hasattr(challenge, "initial_data"):
                challenge.initial_data = {}
            if "flow_info" not in challenge.initial_data:
                flow_info = ContextualFlowInfo(
                    data={
                        "title": self.format_title(),
                        "background": self.executor.flow.background_url(self.request),
                        "cancel_url": reverse("authentik_flows:cancel"),
                        "layout": self.executor.flow.layout,
                    }
                )
                flow_info.is_valid()
                challenge.initial_data["flow_info"] = flow_info.data
            if isinstance(challenge, WithUserInfoChallenge):
                # If there's a pending user, update the `username` field
                # this field is only used by password managers.
                # If there's no user set, an error is raised later.
                if user := self.get_pending_user(for_display=True):
                    challenge.initial_data["pending_user"] = user.username
                challenge.initial_data["pending_user_avatar"] = DEFAULT_AVATAR
                if not isinstance(user, AnonymousUser):
                    challenge.initial_data["pending_user_avatar"] = get_avatar(user, self.request)
        return challenge

    def get_challenge(self, *args, **kwargs) -> Challenge:
        """Return the challenge that the client should solve"""
        raise NotImplementedError

    def challenge_valid(self, response: ChallengeResponse) -> HttpResponse:
        """Callback when the challenge has the correct format"""
        raise NotImplementedError

    def challenge_invalid(self, response: ChallengeResponse) -> HttpResponse:
        """Callback when the challenge has the incorrect format"""
        challenge_response = self._get_challenge()
        full_errors = {}
        for field, errors in response.errors.items():
            for error in errors:
                full_errors.setdefault(field, [])
                field_error = {
                    "string": str(error),
                }
                if hasattr(error, "code"):
                    field_error["code"] = error.code
                full_errors[field].append(field_error)
        challenge_response.initial_data["response_errors"] = full_errors
        if not challenge_response.is_valid():
            if settings.TEST:
                raise StageInvalidException(
                    (
                        f"Invalid challenge response: \n\t{challenge_response.errors}"
                        f"\n\nValidated data:\n\t {challenge_response.data}"
                        f"\n\nInitial data:\n\t {challenge_response.initial_data}"
                    ),
                )
            self.logger.error(
                "f(ch): invalid challenge response",
                errors=challenge_response.errors,
            )
        return HttpChallengeResponse(challenge_response)


class AccessDeniedStage(ChallengeStageView):
    """Used internally by FlowExecutor's stage_invalid()"""

    error_message: str | None

    def __init__(self, executor: "FlowExecutorView", error_message: str | None = None, **kwargs):
        super().__init__(executor, **kwargs)
        self.error_message = error_message

    def get_challenge(self, *args, **kwargs) -> Challenge:
        return AccessDeniedChallenge(
            data={
                "error_message": str(self.error_message or "Unknown error"),
                "component": "ak-stage-access-denied",
            }
        )

    # This can never be reached since this challenge is created on demand and only the
    # .get() method is called
    def challenge_valid(self, response: ChallengeResponse) -> HttpResponse:  # pragma: no cover
        return self.executor.cancel()


class RedirectStage(ChallengeStageView):
    """Redirect to any URL"""

    def get_challenge(self, *args, **kwargs) -> RedirectChallenge:
        destination = getattr(
            self.executor.current_stage, "destination", reverse("authentik_core:root-redirect")
        )
        return RedirectChallenge(
            data={
                "to": destination,
            }
        )

    def challenge_valid(self, response: ChallengeResponse) -> HttpResponse:
        return HttpChallengeResponse(self.get_challenge())


class SessionEndStage(ChallengeStageView):
    """Stage inserted when a flow is used as invalidation flow. By default shows actions
    that the user is likely to take after signing out of a provider."""

    def get_challenge(self, *args, **kwargs) -> Challenge:
        application: Application | None = self.executor.plan.context.get(PLAN_CONTEXT_APPLICATION)
        data = {
            "component": "ak-stage-session-end",
            "brand_name": self.request.brand.branding_title,
        }
        if application:
            data["application_name"] = application.name
            data["application_launch_url"] = application.get_launch_url(self.get_pending_user())
        if self.request.brand.flow_invalidation:
            data["invalidation_flow_url"] = reverse(
                "authentik_core:if-flow",
                kwargs={
                    "flow_slug": self.request.brand.flow_invalidation.slug,
                },
            )
        return SessionEndChallenge(data=data)

    # This can never be reached since this challenge is created on demand and only the
    # .get() method is called
    def challenge_valid(self, response: ChallengeResponse) -> HttpResponse:  # pragma: no cover
        return self.executor.cancel()
