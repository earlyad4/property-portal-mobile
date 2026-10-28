import * as Sentry from "@sentry/react-native";

const releaseId = process.env.EXPO_PUBLIC_RELEASE_ID || "development-local";
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !__DEV__ && Boolean(dsn),
  environment: process.env.EXPO_PUBLIC_APP_ENV || (__DEV__ ? "development" : "production"),
  release: `org.example.propertyportal@${releaseId}`,
  dist: releaseId,
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
    if (event.request) delete event.request.cookies;
    return event;
  },
});

export function capturePhysicalDeviceVerification() {
  Sentry.captureException(new Error(`PropertyPortal physical-device crash verification ${releaseId}`), {
    tags: { verification: "physical-store-build", release_id: releaseId },
  });
}

export { Sentry };

