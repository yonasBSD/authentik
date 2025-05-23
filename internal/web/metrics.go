package web

import (
	"fmt"
	"io"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	log "github.com/sirupsen/logrus"
	"goauthentik.io/internal/config"
	"goauthentik.io/internal/utils/sentry"
)

var Requests = promauto.NewHistogramVec(prometheus.HistogramOpts{
	Name: "authentik_main_request_duration_seconds",
	Help: "API request latencies in seconds",
}, []string{"dest"})

func (ws *WebServer) runMetricsServer() {
	l := log.WithField("logger", "authentik.router.metrics")

	m := mux.NewRouter()
	m.Use(sentry.SentryNoSampleMiddleware)
	m.Path("/metrics").HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		promhttp.InstrumentMetricHandler(
			prometheus.DefaultRegisterer, promhttp.HandlerFor(prometheus.DefaultGatherer, promhttp.HandlerOpts{
				DisableCompression: true,
			}),
		).ServeHTTP(rw, r)

		// Get upstream metrics
		re, err := http.NewRequest("GET", fmt.Sprintf("%s%s-/metrics/", ws.upstreamURL.String(), config.Get().Web.Path), nil)
		if err != nil {
			l.WithError(err).Warning("failed to get upstream metrics")
			return
		}
		re.Header.Set("Authorization", fmt.Sprintf("Bearer %s", ws.metricsKey))
		res, err := ws.upstreamHttpClient().Do(re)
		if err != nil {
			l.WithError(err).Warning("failed to get upstream metrics")
			return
		}
		_, err = io.Copy(rw, res.Body)
		if err != nil {
			l.WithError(err).Warning("failed to get upstream metrics")
			return
		}
	})
	l.WithField("listen", config.Get().Listen.Metrics).Info("Starting Metrics server")
	err := http.ListenAndServe(config.Get().Listen.Metrics, m)
	if err != nil {
		l.WithError(err).Warning("Failed to start metrics server")
	}
	l.WithField("listen", config.Get().Listen.Metrics).Info("Stopping Metrics server")
}
