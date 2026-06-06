// src/services/email.service.js
/**
 * 📧 Anya Email Service — Gmail OAuth2
 *
 * Uses the same Google credentials already in .env (GOOGLE_CLIENT_ID, 
 * GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN) to send email via Gmail API.
 * Supports: plain text, HTML, and Cloudinary resume URL attachment.
 *
 * No new package needed — uses `googleapis` (already installed).
 */

import { google } from 'googleapis';
import { query } from '../db/pool.js';

// ─── Gmail OAuth2 Client ────────────────────────────────────────────────────

function getGmailClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob' // Desktop app redirect
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// ─── RFC-2822 email builder ─────────────────────────────────────────────────

/**
 * Builds a raw RFC-2822 MIME email string, base64url-encoded for Gmail API.
 * Supports multipart/mixed for attachment (PDF fetched from Cloudinary URL).
 */
async function buildRawEmail({ to, subject, body, fromName, fromEmail, attachmentUrl, attachmentName }) {
  const boundary = `anya_${Date.now()}_boundary`;
  const isHtml   = body.trim().startsWith('<');
  const contentType = isHtml ? 'text/html' : 'text/plain';
  const fromHeader  = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;

  // If there's an attachment URL, fetch it and embed as base64
  if (attachmentUrl) {
    try {
      const res = await fetch(attachmentUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching attachment`);
      const arrayBuf = await res.arrayBuffer();
      const attachBase64 = Buffer.from(arrayBuf).toString('base64');
      const fileName = attachmentName || 'Resume.pdf';

      const rawEmail = [
        `From: ${fromHeader}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        `Content-Type: ${contentType}; charset=UTF-8`,
        `Content-Transfer-Encoding: 7bit`,
        '',
        body,
        '',
        `--${boundary}`,
        `Content-Type: application/pdf; name="${fileName}"`,
        `Content-Disposition: attachment; filename="${fileName}"`,
        `Content-Transfer-Encoding: base64`,
        '',
        attachBase64,
        `--${boundary}--`,
      ].join('\r\n');

      return Buffer.from(rawEmail).toString('base64url');
    } catch (err) {
      console.warn('[Email] Failed to fetch attachment, sending without it:', err.message);
    }
  }

  // Plain email (no attachment)
  const rawEmail = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: ${contentType}; charset=UTF-8`,
    `Content-Transfer-Encoding: 7bit`,
    '',
    body,
  ].join('\r\n');

  return Buffer.from(rawEmail).toString('base64url');
}

function cleanEmailHeader(toStr) {
  if (!toStr) return '';
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = toStr.match(emailRegex);
  if (matches && matches.length > 0) {
    return matches.map(m => m.trim()).join(', ');
  }
  return toStr.trim();
}

// ─── Core send function ─────────────────────────────────────────────────────

/**
 * Sends a single email via Gmail API.
 *
 * @param {object} opts
 * @param {string}  opts.to              - Recipient email address
 * @param {string}  opts.subject         - Email subject
 * @param {string}  opts.body            - Email body (plain text or HTML)
 * @param {string}  [opts.fromName]      - Sender display name (default: from DB profile)
 * @param {string}  [opts.fromEmail]     - Sender email (default: CALENDAR_ID env)
 * @param {string}  [opts.attachmentUrl] - Cloudinary/public URL of file to attach
 * @param {string}  [opts.attachmentName]- Filename to show in email (e.g. "Pawan_Resume.pdf")
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
export async function sendEmail({ to, subject, body, fromName, fromEmail, attachmentUrl, attachmentName, userId, leadName, score }) {
  try {
    const gmail     = getGmailClient();
    const senderEmail = fromEmail || process.env.CALENDAR_ID;
    const cleanedTo = cleanEmailHeader(to);
    const raw = await buildRawEmail({ to: cleanedTo, subject, body, fromName, fromEmail: senderEmail, attachmentUrl, attachmentName });

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    const msgId = response.data.id;
    console.log(`📧 [Email] Sent to ${to} | subject: "${subject}" | msgId: ${msgId}`);

    if (userId) {
      try {
        await query(
          `INSERT INTO email_logs (user_id, sent_to, subject, lead_name, score)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, cleanedTo, subject, leadName || null, score || null]
        );
      } catch (logErr) {
        console.error('⚠️ [Email] Failed to log email to email_logs table:', logErr.message);
      }
    }

    return { success: true, messageId: msgId, to, subject };
  } catch (err) {
    console.error('[Email] Failed to send:', err.message);
    return { success: false, error: err.message, to, subject };
  }
}

export async function getEmailsSentTodayCount(userId) {
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS count 
       FROM email_logs 
       WHERE user_id = $1 AND sent_at >= date_trunc('day', now())`,
      [userId]
    );
    return rows[0]?.count || 0;
  } catch (err) {
    console.error('[Email] Failed to get daily email count:', err.message);
    return 0;
  }
}

// ─── Fetch user bio context for proposals ───────────────────────────────────

/**
 * Fetches the user's full bio context from DB, assembled into a rich
 * userContext object that proposalGenerator.js can use.
 */
export async function getUserBioContext(userId) {
  try {
    const { rows } = await query(
      `SELECT u.name, u.email, u.contact, u.github_url, u.linkedin_url,
              u.location, u.availability, u.edu_degree, u.edu_university,
              u.rate_min, u.rate_max, u.rate_currency, u.preferences,
              COALESCE(
                json_agg(DISTINCT jsonb_build_object('category', s.category, 'name', s.name))
                FILTER (WHERE s.id IS NOT NULL), '[]'
              ) AS skills,
              COALESCE(
                json_agg(DISTINCT wt.type) FILTER (WHERE wt.id IS NOT NULL), '[]'
              ) AS work_types
       FROM users u
       LEFT JOIN user_skills s       ON s.user_id = u.id
       LEFT JOIN user_work_types wt  ON wt.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.id`,
      [userId]
    );

    if (!rows.length) return null;
    const u = rows[0];
    const prefs = u.preferences || {};

    // Build skills string e.g. "React.js, Node.js, TypeScript"
    const skillsFlat = (u.skills || [])
      .map(s => s.name)
      .filter(Boolean)
      .join(', ');

    const resumeUrl      = prefs.resume?.url || null;
    const resumeFileName = prefs.resume?.fileName || `${(u.name || 'Resume').replace(/\s+/g, '_')}.pdf`;
    const resumeText     = prefs.resume?.raw_text || '';

    // Fetch latest current experience role, fallback to preferences, then default to 'Full Stack Engineer'
    let detectedRole = 'Full Stack Engineer';
    try {
      const expRes = await query(
        `SELECT role FROM experience WHERE user_id = $1 ORDER BY is_current DESC, start_date DESC NULLS LAST, created_at DESC LIMIT 1`,
        [userId]
      );
      if (expRes.rows.length && expRes.rows[0].role) {
        detectedRole = expRes.rows[0].role;
      } else if (prefs.role) {
        detectedRole = prefs.role;
      } else if (prefs.primary_role) {
        detectedRole = prefs.primary_role;
      }
    } catch (err) {
      console.warn('[Email] Failed to fetch experience role, using fallback:', err.message);
    }

    return {
      name:        u.name || 'Developer',
      email:       u.email || process.env.CALENDAR_ID,
      contact:     u.contact || '',
      github:      u.github_url || '',
      linkedin:    u.linkedin_url || '',
      location:    u.location || 'Remote',
      availability:u.availability || 'Immediately',
      education:   u.edu_degree ? `${u.edu_degree} from ${u.edu_university || ''}` : '',
      rate:        u.rate_min ? `${u.rate_currency || 'USD'} ${u.rate_min}–${u.rate_max || u.rate_min}/hr` : '',
      skills:      skillsFlat,
      workTypes:   (u.work_types || []).join(', '),
      resumeUrl,
      resumeFileName,
      resumeText,
      pitch:       `Experienced ${skillsFlat ? `in ${skillsFlat}` : 'developer'} — ${u.availability || 'available now'}.`,
      role:        detectedRole,
      // Pass full prefs so proposalGenerator can use life_context etc.
      lifeContext: prefs.life_context || null,
    };
  } catch (err) {
    console.error('[Email] getUserBioContext error:', err.message);
    return null;
  }
}

// ─── Batch proposal sender ───────────────────────────────────────────────────

/**
 * After findLeadsForProposal(), call this to auto-send proposals to all leads
 * that have an email address. Uses user's DB bio + uploaded resume.
 *
 * @param {Array}  leads     - Array of lead objects from lead pipeline
 * @param {object} bioContext - From getUserBioContext()
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false] - If true, logs but doesn't send
 * @param {number}  [opts.delayMs=2000] - Delay between emails (avoid spam filters)
 * @returns {Promise<Array<{to, subject, success, error?}>>}
 */
export async function sendProposalBatch(leads, bioContext, { dryRun = false, delayMs = 2000, userId } = {}) {
  const results = [];

  const sentToday = userId ? await getEmailsSentTodayCount(userId) : 0;
  let remainingLimit = 50 - sentToday;
  if (remainingLimit < 0) remainingLimit = 0;

  console.log(`📊 [Email Batch] Daily status: sent today ${sentToday}/50. Remaining limit: ${remainingLimit}`);

  for (const lead of leads) {
    const email = lead.email;
    if (!email) {
      console.log(`   ⏭️ [Email] No email for lead: ${lead.name || lead.company} — skipping`);
      results.push({ to: null, lead: lead.name || lead.company, skipped: true, reason: 'no_email' });
      continue;
    }

    if (remainingLimit <= 0) {
      console.log(`   ⏭️ [Email Limit Reached] Cannot send email to ${email} (Daily 50 email limit reached) — skipping`);
      results.push({ to: email, lead: lead.name || lead.company, skipped: true, reason: 'daily_limit_reached' });
      continue;
    }

    const subject = lead.proposal?.subject
      || `Proposal for ${lead.company || lead.name} — ${bioContext.name}`;
    const body = lead.proposal?.body
      || buildFallbackBody(lead, bioContext);

    if (dryRun) {
      console.log(`   📋 [Email DRY RUN] Would send to ${email}: "${subject}"`);
      results.push({ to: email, subject, dryRun: true, success: true });
      continue;
    }

    const sendResult = await sendEmail({
      to:             email,
      subject,
      body,
      fromName:       bioContext.name,
      fromEmail:      bioContext.email,
      attachmentUrl:  bioContext.resumeUrl,
      attachmentName: bioContext.resumeFileName,
      userId,
      leadName:       lead.name || lead.company,
      score:          lead.score || null,
    });

    if (sendResult.success) {
      remainingLimit--;
    }

    results.push({ ...sendResult, lead: lead.name || lead.company });

    // Polite delay between sends
    if (delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return results;
}

function buildFallbackBody(lead, bio) {
  return `Hi ${lead.name || 'Team'},

I came across ${lead.company || 'your company'} and I'm very interested in contributing to your team.

I'm ${bio.name}, a ${bio.role} with expertise in ${bio.skills || 'full-stack development'}. 
${bio.education ? `Education: ${bio.education}.` : ''}
I'm ${bio.availability} and open to ${bio.workTypes || 'remote/contract'} engagements.

${bio.github ? `GitHub: ${bio.github}` : ''}
${bio.linkedin ? `LinkedIn: ${bio.linkedin}` : ''}

I've attached my resume for your reference. I'd love to schedule a quick call to discuss how I can add value to your team.

Best regards,
${bio.name}
${bio.contact || bio.email}`;
}
