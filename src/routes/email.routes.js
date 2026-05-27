// src/routes/email.routes.js
/**
 * 📧 Anya Email API Routes
 *
 * POST /api/email/send           — send a single email (custom or proposal)
 * POST /api/email/send-proposals — send proposals to all leads with emails
 * POST /api/email/compose        — AI-compose then send (from natural language instruction)
 */

import { Router } from 'express';
import { sendEmail, getUserBioContext, sendProposalBatch } from '../services/email.service.js';
import { generateProposal } from '../search/providers/proposalGenerator.js';
import { chatWithGlobalFallback } from '../ai/llm-fallback.js';

const router = Router();

// ─── POST /api/email/send ────────────────────────────────────────────────────
// Direct send — you provide to, subject, body (and optional attachResumeUrl flag)
router.post('/send', async (req, res) => {
  try {
    const { to, subject, body, attachResume = false } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ success: false, error: 'to, subject, body are required' });
    }

    let attachmentUrl   = null;
    let attachmentName  = null;
    let fromName        = null;

    if (attachResume) {
      const bio = await getUserBioContext(req.userId);
      attachmentUrl  = bio?.resumeUrl  || null;
      attachmentName = bio?.resumeFileName || 'Resume.pdf';
      fromName       = bio?.name || null;
    }

    const result = await sendEmail({ to, subject, body, fromName, attachmentUrl, attachmentName });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/email/send-proposals ─────────────────────────────────────────
// Takes an array of leads (from lead pipeline) and fires proposal emails to all
// leads that have an email address. Attaches resume automatically.
router.post('/send-proposals', async (req, res) => {
  try {
    const { leads, dryRun = false, delayMs = 2000 } = req.body;

    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ success: false, error: 'leads array is required' });
    }

    const bio = await getUserBioContext(req.userId);
    if (!bio) {
      return res.status(404).json({ success: false, error: 'User profile not found' });
    }

    // Generate proposals for leads that don't already have one
    const enrichedLeads = [];
    for (const lead of leads) {
      if (!lead.proposal) {
        const prop = await generateProposal(lead, bio, 'freelance_pitch');
        enrichedLeads.push({ ...lead, proposal: prop.success ? prop : null });
      } else {
        enrichedLeads.push(lead);
      }
    }

    const results = await sendProposalBatch(enrichedLeads, bio, { dryRun, delayMs });

    const sent    = results.filter(r => r.success && !r.dryRun && !r.skipped);
    const skipped = results.filter(r => r.skipped);
    const failed  = results.filter(r => !r.success && !r.skipped);

    res.json({
      success: true,
      summary: {
        total:   leads.length,
        sent:    sent.length,
        skipped: skipped.length,
        failed:  failed.length,
        dryRun,
      },
      results,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/email/compose ─────────────────────────────────────────────────
// Natural language → AI composes the email → sends it
// Body: { instruction: "write a thank you to john@example.com", attachResume: true }
router.post('/compose', async (req, res) => {
  try {
    const { instruction, attachResume = false } = req.body;

    if (!instruction) {
      return res.status(400).json({ success: false, error: 'instruction is required' });
    }

    // Fetch user bio for context
    const bio = await getUserBioContext(req.userId);

    const bioSnippet = bio ? `
Sender info:
- Name: ${bio.name}
- Email: ${bio.email}
- Skills: ${bio.skills}
- GitHub: ${bio.github}
- LinkedIn: ${bio.linkedin}
` : '';

    // Ask AI to extract recipient + compose the email
    const aiResult = await chatWithGlobalFallback({
      taskName: 'email_compose',
      messages: [
        {
          role: 'system',
          content: `You are an expert email composer. Extract recipient info and write a professional email.
${bioSnippet}
Output ONLY a JSON object:
{
  "to": "recipient@example.com",
  "subject": "Email subject",
  "body": "Complete email body text (plain text, no markdown)"
}`,
        },
        {
          role: 'user',
          content: `Instruction: ${instruction}`,
        },
      ],
      groqModels: ['llama-3.3-70b-versatile'],
      mistralModels: ['mistral-small-latest'],
      githubModels: ['gpt-4o-mini'],
      temperature: 0.4,
      maxTokens: 500,
      responseFormat: { type: 'json_object' },
    });

    if (!aiResult.success) {
      return res.status(500).json({ success: false, error: 'AI composition failed: ' + aiResult.error });
    }

    let composed;
    try {
      let text = aiResult.content.trim()
        .replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/```$/, '');
      const js = text.indexOf('{');
      const je = text.lastIndexOf('}');
      if (js !== -1 && je !== -1) text = text.substring(js, je + 1);
      composed = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({ success: false, error: 'AI returned invalid JSON', raw: aiResult.content });
    }

    if (!composed.to || !composed.subject || !composed.body) {
      return res.status(422).json({
        success: false,
        error: 'AI could not extract recipient/subject/body',
        composed,
      });
    }

    const result = await sendEmail({
      to:            composed.to,
      subject:       composed.subject,
      body:          composed.body,
      fromName:      bio?.name,
      attachmentUrl: attachResume ? bio?.resumeUrl  : null,
      attachmentName:attachResume ? bio?.resumeFileName : null,
    });

    res.json({ ...result, composed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
