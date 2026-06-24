import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    base: "./",
    build: {
      chunkSizeWarningLimit: 2000,
    },
    server: {
      fs: {
        allow: [".."],
      },
      proxy: {
        "/api/clear/graphql": {
          target: "https://api.clearinitiative.io",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/clear/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              const key = env.CLEAR_API_KEY?.trim();
              if (key) {
                proxyReq.setHeader("Authorization", `Bearer ${key}`);
              }
            });
          },
        },
        "/api/osrm": {
          target: "https://router.project-osrm.org",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/osrm/, ""),
        },
        "/api/nominatim": {
          target: "https://nominatim.openstreetmap.org",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/nominatim/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("User-Agent", "NRC-Clear-TerraBit/1.0 (contact@example.com)");
            });
          },
        },
      },
    },
  };
});
