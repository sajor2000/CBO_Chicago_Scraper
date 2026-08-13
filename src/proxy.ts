import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware(() => {
  // Protected resources check auth themselves so document requests can redirect
  // to the app's explicit /sign-in route before Clerk's dev-browser guard runs.
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*"
  ]
};
