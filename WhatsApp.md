# WhatsApp Report Integration - Cron Jobs

Steps to set up automated WhatsApp reports for the administrator.

## 1. Choose a WhatsApp Business API Provider

- **Option A: Meta WhatsApp Cloud API** (official, free tier available, requires Facebook Business verification)
- **Option B: Third-party provider** - Twilio, MessageBird, 360dialog, WATI, Interakt (these wrap the Cloud API or use the Business Solution API)
- Get API credentials: phone number ID, access token, WhatsApp Business account ID

## 2. Create Template Messages (Pre-Approved)

WhatsApp requires template messages for outbound notifications (not free-form). Create templates such as:

- **Daily Sales Report:** Daily Sales Report: Total revenue UGX {amount}, {count} transactions, top payment method {method}
- **Low Stock Alert:** Low Stock Alert: {product} is below reorder level ({qty} remaining, reorder at {level})
- **Stock-Out Alert:** Stock-Out Alert: {product} has run out of stock (SKU: {sku})
- **Weekly Summary:** Weekly Summary: Revenue UGX {amount}, {count} sales, {bikes} bikes sold, {approval} pending approvals

Submit templates via the provider API or dashboard; wait for approval before use.

## 3. Set Up a Cron Job on the Server

- Use node-cron (in-process) or a system cron (crontab -e) that calls a Node script
- System cron is more reliable - survives server restarts, independent of the Express process
- Examples:
  - 0 7 * * * - daily report at 7 AM
  - 0 8 * * 1 - weekly report every Monday at 8 AM
  - */15 * * * * - low-stock check every 15 minutes

## 4. Write the Report Generation Script

The script queries the database directly (or calls your own API) to generate:

- Daily: revenue, transaction count, top products, payment mix, low-stock items, pending approvals
- Weekly: same plus week-over-week comparison

Format the data into a readable text summary. Keep it concise - WhatsApp messages have a 4096-character limit.

## 5. Send via WhatsApp API

- Use the provider SDK or direct HTTP call to send the template message to the admin WhatsApp number
- Store the admin WhatsApp number in the database (new column on users table: whatsapp_number TEXT)
- Add a settings UI in admin to enable/disable WhatsApp reports and enter the phone number
- Use the approved template name and fill variables with actual data

## 6. Handle Delivery and Errors

- Log send results (delivered, failed, rejected)
- Implement retry for transient failures (network errors, rate limits)
- Respect WhatsApp rate limits - template messages have cooldown periods
- Remove invalid phone numbers from the subscription list on persistent failures

## 7. Security Considerations

- Store WhatsApp API tokens in .env (not in code)
- Validate the admin WhatsApp number before sending (confirmation step)
- Do not send sensitive data - summaries only, no full customer lists or payment details
- Use a dedicated service account for the cron job, not the admin personal credentials

## 8. Testing

- Send test messages to your own number first
- Verify template approval workflow (can take hours to days for Meta)
- Test cron execution manually before relying on the schedule: node scripts/whatsapp-report.js
- Verify the message arrives with correct formatting on both Android and iOS WhatsApp
- Test edge cases: zero sales day, empty stock, no admin WhatsApp number configured
