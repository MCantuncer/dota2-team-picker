/**
 * Builds the auth email templates in supabase/templates from one shared layout.
 *
 *   npm run emails -w services/accounts
 *
 * Supabase renders the files with Go's html/template, so {{ .Data.team_name }} and the like are
 * filled in when it sends. Two rules follow from that: no HTML comments (html/template drops
 * them, so no Outlook conditional comments either), and any user text goes through {{ }} so it
 * is escaped. Everything else follows the usual email rules: table layout, inline styles, a
 * hidden preheader, a padded-cell button and the link written out as text.
 *
 * Colors match the website's tokens in dota2-team-picker-web/src/app/globals.css.
 */

const color = {
  bg: "#0c0f14",
  surface: "#131820",
  raised: "#1a2029",
  line: "#232a35",
  fg: "#e6e8eb",
  muted: "#a1a9b5",
  subtle: "#7f8896",
  accent: "#c9a45c",
  onAccent: "#17130a",
  radiant: "#8cc265",
  dire: "#e5654d",
};

const display = "'Barlow Semi Condensed','Arial Narrow',Arial,sans-serif";
const text = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const mono = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

export interface Email {
  /** File name in supabase/templates. */
  file: string;
  /** Subject line, also set in config.toml. Static text: html/template would escape names in it. */
  subject: string;
  /** The dashboard's name for this template, used in the README steps. */
  dashboard: string;
  /** Inbox preview line, hidden in the email itself. */
  preheader: string;
  eyebrow: string;
  heading: string;
  /** HTML paragraphs and blocks between the heading and the button. */
  body: string;
  button?: { label: string; href: string };
  /** HTML after the button. */
  after?: string;
  /** Why they got it and what to do if it wasn't them. */
  note: string;
}

export const p = (html: string) =>
  `<p style="margin:0 0 16px;font-family:${text};font-size:15px;line-height:24px;color:${color.muted};">${html}</p>`;

export const strong = (html: string) => `<strong style="color:${color.fg};font-weight:600;">${html}</strong>`;

/** A raised panel of label/value rows, like the cards on the site. */
export function panel(rows: [string, string][]): string {
  const cells = rows
    .map(
      ([label, value], i) => `<tr>
<td style="padding:${i ? "12px" : "16px"} 20px ${i === rows.length - 1 ? "16px" : "0"};font-family:${text};">
<div style="font-family:${display};font-size:11px;line-height:16px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${color.subtle};">${label}</div>
<div style="font-family:${display};font-size:20px;line-height:26px;font-weight:700;color:${color.fg};">${value}</div>
</td>
</tr>`,
    )
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;border-collapse:separate;">
<tr>
<td width="4" style="width:4px;background-color:${color.accent};border-radius:4px 0 0 4px;font-size:0;line-height:0;">&nbsp;</td>
<td style="background-color:${color.raised};border:1px solid ${color.line};border-left:0;border-radius:0 6px 6px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${cells}
</table>
</td>
</tr>
</table>`;
}

/** A one-time code, big and easy to copy. */
export function code(value: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
<tr>
<td style="padding:14px 24px;background-color:${color.raised};border:1px solid ${color.line};border-radius:6px;font-family:${mono};font-size:30px;line-height:36px;font-weight:700;letter-spacing:8px;color:${color.accent};">${value}</td>
</tr>
</table>`;
}

function button({ label, href }: { label: string; href: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
<tr>
<td align="center" bgcolor="${color.accent}" style="background-color:${color.accent};border-radius:6px;">
<a href="${href}" target="_blank" class="btn" style="display:inline-block;padding:14px 28px;font-family:${display};font-size:16px;line-height:20px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${color.onAccent};text-decoration:none;border-radius:6px;">${label}</a>
</td>
</tr>
</table>
<p style="margin:0 0 20px;font-family:${text};font-size:13px;line-height:20px;color:${color.subtle};">Button not working? Paste this link into your browser:<br><a href="${href}" target="_blank" style="color:${color.accent};text-decoration:underline;word-break:break-all;">${href}</a></p>`;
}

/** Padding after the preview text, so the inbox doesn't show the start of the body after it. */
const previewSpacer = "&#8204;&nbsp;".repeat(60);

export function render(email: Email): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${email.subject}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@600;700&amp;display=swap" rel="stylesheet">
<style>
:root { color-scheme: dark; supported-color-schemes: dark; }
body { margin: 0; padding: 0; width: 100% !important; background-color: ${color.bg}; }
a { color: ${color.accent}; }
a.btn:hover { background-color: #d9b670 !important; }
@media only screen and (max-width: 600px) {
  .content { padding: 28px 20px !important; }
  .outer { padding: 16px 8px !important; }
  h1 { font-size: 26px !important; line-height: 32px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${color.bg};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${color.bg};">${email.preheader}${previewSpacer}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${color.bg}" style="background-color:${color.bg};">
<tr>
<td align="center" class="outer" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr>
<td style="padding:0 4px 16px;">
<a href="{{ .SiteURL }}" target="_blank" style="text-decoration:none;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="padding-right:10px;vertical-align:middle;"><img src="{{ .SiteURL }}/email/logo.png" width="28" height="28" alt="" style="display:block;border:0;outline:none;"></td>
<td style="vertical-align:middle;font-family:${display};font-size:17px;line-height:20px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${color.fg};">Dota 2 Team Picker</td>
</tr>
</table>
</a>
</td>
</tr>
<tr>
<td bgcolor="${color.surface}" style="background-color:${color.surface};border:1px solid ${color.line};border-radius:8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td width="50%" height="3" bgcolor="${color.radiant}" style="height:3px;background-color:${color.radiant};border-radius:8px 0 0 0;font-size:0;line-height:0;">&nbsp;</td>
<td width="50%" height="3" bgcolor="${color.dire}" style="height:3px;background-color:${color.dire};border-radius:0 8px 0 0;font-size:0;line-height:0;">&nbsp;</td>
</tr>
<tr>
<td colspan="2" class="content" style="padding:36px 40px 32px;">
<div style="margin:0 0 8px;font-family:${display};font-size:13px;line-height:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${color.accent};">${email.eyebrow}</div>
<h1 style="margin:0 0 20px;font-family:${display};font-size:30px;line-height:36px;font-weight:700;color:${color.fg};">${email.heading}</h1>
${email.body}
${email.button ? button(email.button) : ""}
${email.after ?? ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding-top:8px;border-top:1px solid ${color.line};font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
<p style="margin:8px 0 0;font-family:${text};font-size:13px;line-height:20px;color:${color.subtle};">${email.note}</p>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td align="center" style="padding:20px 16px 0;font-family:${text};font-size:12px;line-height:18px;color:${color.subtle};">
<a href="{{ .SiteURL }}" target="_blank" style="color:${color.muted};text-decoration:none;">Dota 2 Team Picker</a> &middot; Draft picks that fit your team.<br>
Not affiliated with Valve. Dota 2 is a trademark of Valve Corporation.
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
`;
}

// The invite and sign-in emails get the captain and team from the user's metadata, which the
// team-invite function sets. Supabase can also send these without it (from the dashboard), so
// each one has a plain version.
const hasTeam = "{{ if .Data.team_name }}";
const captain = "{{ if .Data.captain_name }}{{ .Data.captain_name }}{{ else }}Your captain{{ end }}";
const captainLower = "{{ if .Data.captain_name }}{{ .Data.captain_name }}{{ else }}your captain{{ end }}";
const team = "{{ .Data.team_name }}";
const expiry = "The link works once and expires in 1 hour.";

const teamPanel = panel([
  ["Team", team],
  ["Captain", captain],
]);

export const emails: Email[] = [
  {
    file: "invite.html",
    dashboard: "Invite user",
    subject: "You're invited to a team on Dota 2 Team Picker",
    preheader: `${hasTeam}${captain} wants you on ${team}. Join in about a minute.{{ else }}Join your team in about a minute.{{ end }}`,
    eyebrow: "Team invite",
    heading: `${hasTeam}${captain} invited you to ${team}{{ else }}You've been invited to a team{{ end }}`,
    body: `${hasTeam}${teamPanel}{{ end }}
${p(`Join on Dota 2 Team Picker so ${captainLower} can call heroes for you that fit your positions and the heroes you play best.`)}`,
    button: { label: "Join the team", href: "{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=invite" },
    after: p(`It takes about a minute: pick a name and password, then your positions and favorite heroes.`),
    note: `${expiry} If it has expired, ask ${captainLower} to send the invite again. Not expecting this? You can ignore this email.`,
  },
  {
    file: "magic_link.html",
    dashboard: "Magic link",
    subject: "Your Dota 2 Team Picker link",
    preheader: `${hasTeam}${captain} wants you on ${team}. Sign in to join.{{ else }}Your sign-in link for Dota 2 Team Picker.{{ end }}`,
    eyebrow: `${hasTeam}Team invite{{ else }}Sign in{{ end }}`,
    heading: `${hasTeam}${captain} invited you to ${team}{{ else }}Sign in to Dota 2 Team Picker{{ end }}`,
    body: `${hasTeam}${teamPanel}
${p(`You already have an account, so just sign in to accept. The team will see your positions and favorite heroes.`)}{{ else }}${p(`Use the button below to sign in as ${strong("{{ .Email }}")}.`)}{{ end }}`,
    button: {
      label: `${hasTeam}Sign in and join{{ else }}Sign in{{ end }}`,
      href: "{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=magiclink",
    },
    note: `${expiry} Not expecting this? You can ignore this email; nobody can sign in without the link.`,
  },
  {
    file: "confirmation.html",
    dashboard: "Confirm signup",
    subject: "Confirm your email for Dota 2 Team Picker",
    preheader: "One click to finish creating your account.",
    eyebrow: "Welcome",
    heading: "Confirm your email",
    body: p(`Thanks for signing up. Confirm ${strong("{{ .Email }}")} to finish creating your account and start drafting with your team.`),
    button: { label: "Confirm email", href: "{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email" },
    note: `${expiry} Didn't sign up? You can ignore this email and no account will be activated.`,
  },
  {
    file: "recovery.html",
    dashboard: "Reset password",
    subject: "Reset your Dota 2 Team Picker password",
    preheader: "Choose a new password for your account.",
    eyebrow: "Password reset",
    heading: "Reset your password",
    body: p(`Someone asked to reset the password for ${strong("{{ .Email }}")}. If it was you, choose a new one below.`),
    button: { label: "Choose a new password", href: "{{ .ConfirmationURL }}" },
    note: `${expiry} Didn't ask for this? Ignore this email and your password stays the same.`,
  },
  {
    file: "email_change.html",
    dashboard: "Change email address",
    subject: "Confirm your new email for Dota 2 Team Picker",
    preheader: "Confirm the change to your account's email address.",
    eyebrow: "Email change",
    heading: "Confirm your new email",
    body: `${panel([
      ["From", "{{ .Email }}"],
      ["To", "{{ .NewEmail }}"],
    ])}
${p("Confirm to start signing in with the new address.")}`,
    button: { label: "Confirm new email", href: "{{ .ConfirmationURL }}" },
    note: `${expiry} Didn't ask for this? Ignore this email and your email stays the same.`,
  },
  {
    file: "reauthentication.html",
    dashboard: "Reauthentication",
    subject: "Your Dota 2 Team Picker verification code",
    preheader: "Your code: {{ .Token }}",
    eyebrow: "Verification",
    heading: "Confirm it's you",
    body: `${p("Enter this code to continue:")}
${code("{{ .Token }}")}`,
    note: "The code expires in 1 hour. Didn't ask for this? Change your password, since someone else may be using your account.",
  },
];

const dir = new URL("../templates/", import.meta.url);

if (import.meta.main) {
  for (const email of emails) {
    await Deno.writeTextFile(new URL(email.file, dir), render(email));
    console.log(`templates/${email.file}`);
  }
}
