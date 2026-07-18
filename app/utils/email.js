const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);
const baseFrontendUrl = process.env.BASE_FRONTEND_URL;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// strip out html and convert to plain text (e.g. for quoting rich-text comments)
function commentToPlainText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n") // turn <br> tags into line breaks
    .replace(/<\/(p|div|li)>/gi, "\n") // add a line break after each block element
    .replace(/<[^>]+>/g, "") // strip out any remaining html tags
    .replace(/&nbsp;/gi, " ") // convert non-breaking spaces to regular spaces
    .replace(/\n{3,}/g, "\n\n") // collapse 3+ blank lines down to one blank line
    .trim();
}

function storyUrl(story, { acId } = {}) {
  const url = `${baseFrontendUrl}/projects/${story.projectId}/stories/${story.id}`;
  return acId ? `${url}?ac=${acId}` : url;
}

async function sendEmail(to, subject, text, options = {}) {
  const context = options.context ?? [];
  const contextHTML = `<ul style="color: #555; font-size: 14px; padding-left: 20px;">${context
    .map((item) => {
      const value = item.url
        ? `<a href="${item.url}" style="color: #80162B;">${item.value}</a>`
        : item.value;
      return `<strong>${item.label}:</strong> ${value}`;
    })
    .join("<br>")}`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 8px;">
      <div style="color: #80162B; font-size: 20px; font-weight: bold; margin-bottom: 16px;">Nimble</div>
      ${contextHTML}
      <br><br>
      <div style="font-size: 15px; line-height: 1.5;">${text}</div>
    </div>`;

  const { data, error } = await resend.emails.send({
    from: "Nimble <onboarding@resend.dev>",
    to: [to],
    subject: subject,
    html,
  });

  if (error) {
    throw error;
  }
}

async function notifyMentionedUser(mentioned, mentioner, comment, context) {
  const subject = `${mentioner.firstName} mentioned you`;
  const text = `${mentioner.firstName} ${mentioner.lastName} mentioned you in a comment. Here's what they said:
  <br>
  <blockquote style="margin: 12px 0; padding: 8px 16px; border-left: 4px solid #80162B; background: #f9f9f9; color: #555; font-style: italic;">${commentToPlainText(comment.content)}</blockquote>
  `;

  await sendEmail(mentioned.email, subject, text, {
    context,
  });
}

async function notifyAssignedUser(assignee, assigner, story, context) {
  const subject = `${assigner.firstName} assigned you a story`;
  const text = `${assigner.firstName} ${assigner.lastName} assigned you to the story "${escapeHtml(story.title)}".`;

  await sendEmail(assignee.email, subject, text, {
    context,
  });
}

async function notifyReviewerUser(reviewer, assigner, story, context) {
  const subject = `${assigner.firstName} requested your review`;
  const text = `${assigner.firstName} ${assigner.lastName} asked you to review the story "${escapeHtml(story.title)}".`;

  await sendEmail(reviewer.email, subject, text, {
    context,
  });
}

module.exports = {
  sendEmail,
  storyUrl,
  notifyMentionedUser,
  notifyAssignedUser,
  notifyReviewerUser,
  commentToPlainText,
};
