import { defineApp } from "convex/server";

const app = defineApp();

// Configure Resend component for email notifications
app.use("resend", {
  apiKey: process.env.RESEND_API_KEY!,
});

export default app;