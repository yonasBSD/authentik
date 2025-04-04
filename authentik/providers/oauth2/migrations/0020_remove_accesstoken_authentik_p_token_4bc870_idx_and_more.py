# Generated by Django 5.0.9 on 2024-09-27 14:50

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentik_providers_oauth2", "0019_accesstoken_authentik_p_token_4bc870_idx_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    # Original preserved
    # See https://github.com/goauthentik/authentik/issues/11874
    # operations = [
    #     migrations.RemoveIndex(
    #         model_name="accesstoken",
    #         name="authentik_p_token_4bc870_idx",
    #     ),
    #     migrations.RemoveIndex(
    #         model_name="refreshtoken",
    #         name="authentik_p_token_1a841f_idx",
    #     ),
    #     migrations.AddIndex(
    #         model_name="accesstoken",
    #         index=models.Index(fields=["token", "provider"], name="authentik_p_token_f99422_idx"),
    #     ),
    #     migrations.AddIndex(
    #         model_name="refreshtoken",
    #         index=models.Index(fields=["token", "provider"], name="authentik_p_token_a1d921_idx"),
    #     ),
    # ]
    operations = []
