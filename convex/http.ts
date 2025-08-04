import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth.js";

const http = httpRouter();

// Add Convex Auth routes
auth.addHttpRoutes(http);

// Resend webhook handler for email delivery status
http.route({
  path: "/webhook/resend",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Verify webhook signature if secret is provided
      const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
      if (webhookSecret) {
        const signature = request.headers.get("resend-signature");
        if (!signature) {
          return new Response("Missing signature", { status: 401 });
        }
        // In a production environment, you would verify the signature here
        // For now, we'll skip signature verification for development
      }

      // Parse the webhook payload
      const payload = await request.json();
      
      // Extract event data
      const { type, data } = payload;
      
      if (!type || !data) {
        return new Response("Invalid payload", { status: 400 });
      }

      // Handle the email event
      await ctx.runMutation(internal.notifications.handleEmailEvent, {
        id: data.email_id || data.id,
        event: {
          type,
          data,
        },
      });

      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Webhook error:", error);
      return new Response("Internal server error", { status: 500 });
    }
  }),
});

export default http;