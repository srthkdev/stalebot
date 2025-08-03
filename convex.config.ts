import { defineApp } from "convex/server";
import { components } from "./_generated/api";

const app = defineApp();

// Configure Resend component for email notifications
app.use(components.resend, {
  apiKey: process.env.RESEND_API_KEY!,
});

export default app;