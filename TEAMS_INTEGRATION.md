# Microsoft Teams Integration Setup

This app can auto-create tickets from messages posted in a Teams channel.
Getting this genuinely working requires two things that can't be done
from inside this app: an **Azure AD app registration** (your organization's
identity admin sets this up), and a **public HTTPS URL** for this backend
(Microsoft's servers need to be able to reach it - `localhost` will not
work).

## Step 1: Request an Azure AD app registration

Someone with Azure AD admin rights at your organization needs to do this -
it's the same kind of formal access request as the AWS one. Here's exactly
what to ask for:

---

**Subject: Azure AD App Registration - Teams Channel Integration**

> Hi [IT/Azure Admin],
>
> I'd like to set up an integration that reads messages from a specific
> Teams channel and creates tickets from them automatically. This needs
> an Azure AD app registration with the following:
>
> **App registration:**
> - A new App Registration in Azure AD (any name, e.g. "IssueTrack Teams Integration")
> - A **client secret** generated for it (I'll need the secret value once, at creation time)
> - The **Tenant ID**, **Application (client) ID**, and the **client secret value**
>
> **API permissions (Microsoft Graph, Application type - not Delegated):**
> - `ChannelMessage.Read.All` - to read messages in the channel
> - `ChannelMessage.Send` - to post assignment notifications back into the channel
> - `Channel.ReadBasic.All` - to identify channels
> - `Team.ReadBasic.All` - to identify teams
> - `User.Read.All` - to look up a teammate's Teams identity by their work email, so we can @mention them correctly
>
> These are Application permissions, so they'll need **admin consent**
> granted in the Azure Portal after being added - a normal user consent
> prompt won't be enough.
>
> Please let me know the Tenant ID, Client ID, and client secret once
> this is set up, and I'll take it from there.
>
> Thanks,
> [Your Name]

---

## Step 2: Get a public HTTPS URL for the backend

Microsoft Graph will only send webhook notifications to a real, publicly
reachable HTTPS address - it cannot reach your laptop or `localhost`. This
means the Teams integration only becomes testable once the backend from
this project is deployed somewhere public (Railway, Render, AWS, etc. -
see the earlier deployment steps in this project).

## Step 3: Configure the backend

Once you have the three Azure values and a public URL, fill these into
`backend/.env`:

```
MS_TENANT_ID=<Tenant ID from Azure>
MS_CLIENT_ID=<Application (client) ID from Azure>
MS_CLIENT_SECRET=<the client secret value>
MS_TEAMS_WEBHOOK_URL=https://your-public-backend-url.com/integrations/teams/webhook
```

Restart the backend after setting these.

## Step 4: Find the Team ID and Channel ID

In Microsoft Teams:
1. Right-click (or use the "More options" `...` menu) on the channel you want to connect
2. Choose **"Get link to channel"**
3. The copied link contains both IDs, e.g.:
   ```
   https://teams.microsoft.com/l/channel/19%3aabc123.../GeneralChannel?groupId=11111111-2222-3333-4444-555555555555&tenantId=...
   ```
   - The part after `/channel/` and before the channel name (URL-decoded) is the **Channel ID**
   - `groupId` in the query string is the **Team ID**

## Step 5: Connect it in the app

As an admin, go to **Teams Integration** in the sidebar, paste in the Team ID
and Channel ID, optionally pick which project new tickets should land in,
and click **Connect Channel**.

## How it works once connected

- The backend asks Microsoft Graph to notify it whenever a new message
  is posted in that channel (this is called a "subscription")
- Microsoft calls our `/integrations/teams/webhook` endpoint when that happens
- The backend fetches the full message and checks who was **@mentioned** in it
- **A ticket is only created if someone tagged in the message is a real
  user in this app** (matched by their work email) - ordinary channel
  chatter with no recognized teammate tagged is ignored entirely, so this
  doesn't flood your tracker with noise
- The tagged person automatically becomes the ticket's **assignee** - no
  manual assignment step needed
- The ticket is created with **Mode: Auto**, description = the message
  text (HTML stripped), and it's linked to whichever project you chose
  when connecting the channel
- Subscriptions expire and are automatically renewed by the backend every
  15 minutes (well before the ~55 minute expiry), so this should keep
  running indefinitely without manual attention

## Assignment notifications (outbound)

Once a channel is connected, it works both directions:

- **Inbound**: new messages in that channel become tickets (as described above)
- **Outbound**: whenever a ticket linked to that channel's project gets assigned (or reassigned) to someone new, the backend posts a message in that same channel and **@mentions the assignee** by name, so they get a real Teams notification

If a ticket has no project, or its project has no connected channel, nothing is sent - the assignment still works normally in the portal, it just has nowhere to notify.

Reassigning a ticket to the *same* person it's already assigned to does not re-send a notification - only an actual change of assignee triggers one.

## Known limitation

Auto-created tickets record who posted the message as a fixed system
identity (`teams-integration@system.local`), not the actual sender - only
the **tagged/assigned person** is resolved to a real account. Showing the
real sender would need one more Graph lookup on the message's `from`
field; left as a future improvement since it doesn't affect who the
ticket is assigned to.

## Testing without real Azure access

Everything up to the live Microsoft connection has been tested:
webhook signature/validation handling, the logic that turns a Teams
message into a ticket, and the assignment-notification decision logic
(skips gracefully when there's no project or no connected channel, and
doesn't re-notify when reassigning to the same person). The actual live
connection to Microsoft Graph (authentication, creating the subscription,
receiving a real notification, and actually posting a message back) can
only be verified once real Azure credentials and a public URL are in
place - that's the point to test end-to-end together.
