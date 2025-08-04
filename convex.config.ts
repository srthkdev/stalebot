import { defineApp } from "convex/server";
import resend from "@convex-dev/resend/convex.config";

const app = defineApp();

// Configure Resend component for email notifications
app.use(resend);

export default app;