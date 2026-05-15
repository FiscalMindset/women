import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/kestra-webhook": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: () => "/api/v1/main/executions/webhook/sentinel.grid/sentinel_core/sentinel-grid-intake",
      },
      "/kestra-register-helper": {
        target: "http://localhost:8080",
        changeOrigin: true,
        headers: { Authorization: "Basic YWRtaW5Aa2VzdHJhLmlvOlNlbnRpbmVsMQ==" },
        rewrite: () => "/api/v1/main/executions/webhook/sentinel.grid/register_responder/register-responder",
      },
      "/kestra-location-ping": {
        target: "http://localhost:8080",
        changeOrigin: true,
        headers: { Authorization: "Basic YWRtaW5Aa2VzdHJhLmlvOlNlbnRpbmVsMQ==" },
        rewrite: () => "/api/v1/main/executions/webhook/sentinel.grid/responder_location_ping/location-ping",
      },
      "/kestra-accept-alert": {
        target: "http://localhost:8080",
        changeOrigin: true,
        headers: { Authorization: "Basic YWRtaW5Aa2VzdHJhLmlvOlNlbnRpbmVsMQ==" },
        rewrite: () => "/api/v1/main/executions/webhook/sentinel.grid/responder_accept_alert/accept-alert",
      },
      "/kestra-admin-snapshot": {
        target: "http://localhost:8080",
        changeOrigin: true,
        headers: { Authorization: "Basic YWRtaW5Aa2VzdHJhLmlvOlNlbnRpbmVsMQ==" },
        rewrite: () => "/api/v1/main/executions/webhook/sentinel.grid/admin_ops_snapshot/admin-snapshot",
      },
      "/kestra-api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        headers: { Authorization: "Basic YWRtaW5Aa2VzdHJhLmlvOlNlbnRpbmVsMQ==" },
        rewrite: (path) => {
          if (path.startsWith("/kestra-api/executions/")) {
            return path.replace(/^\/kestra-api/, "/api/v1/main");
          }
          return path.replace(/^\/kestra-api/, "/api/v1/main");
        },
      },
    },
  },
});
