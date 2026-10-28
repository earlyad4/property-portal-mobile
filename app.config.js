const base = require("./app.json");

function validateEndpoint(name, value, protocol) {
  if (!value) throw new Error(`${name} is required for preview and production builds`);
  const url = new URL(value);
  if (url.protocol !== protocol) throw new Error(`${name} must use ${protocol}`);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error(`${name} must not point to localhost`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${name} must be a clean origin`);
}

module.exports = () => {
  const profile = process.env.EAS_BUILD_PROFILE || "development";
  if (["preview", "production"].includes(profile)) {
    validateEndpoint("EXPO_PUBLIC_API_BASE", process.env.EXPO_PUBLIC_API_BASE, "https:");
    validateEndpoint("EXPO_PUBLIC_WS_BASE", process.env.EXPO_PUBLIC_WS_BASE, "wss:");
    if (!process.env.EXPO_PUBLIC_RELEASE_ID) throw new Error("EXPO_PUBLIC_RELEASE_ID is required for release builds");
  }
  return {
    ...base.expo,
    plugins: [...(profile === "development" ? (base.expo.plugins || []) : []), "@sentry/react-native/expo"],
    extra: { ...base.expo.extra, releaseId: process.env.EXPO_PUBLIC_RELEASE_ID || "development-local" },
  };
};
