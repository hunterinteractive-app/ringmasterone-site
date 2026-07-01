const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function row(label: string, value: string) {
  return `
    <tr>
      <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #d9e2ea;color:#082640;width:220px;">${escapeHtml(label)}</th>
      <td style="padding:8px 10px;border-bottom:1px solid #d9e2ea;">${escapeHtml(value || 'Not provided')}</td>
    </tr>
  `;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  let payload: Record<string, unknown>;

  try {
    payload = await req.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  if (clean(payload.website)) {
    return jsonResponse({ ok: true });
  }

  const contactName = clean(payload.contact_name);
  const organizationName = clean(payload.organization_name);
  const email = clean(payload.email).toLowerCase();
  const phone = clean(payload.phone);
  const eventName = clean(payload.event_name);
  const eventDate = clean(payload.event_date);
  const eventType = clean(payload.event_type);
  const estimatedEntries = clean(payload.estimated_entries);
  const showSanctions = clean(payload.show_sanctions);
  const entryCloseDate = clean(payload.entry_close_date);
  const paymentMethod = clean(payload.payment_method);
  const requestedDiscount = clean(payload.requested_discount);
  const notes = clean(payload.notes);
  const approvalTerms = payload.approval_terms === true ||
    clean(payload.approval_terms).toLowerCase() === 'true' ||
    clean(payload.approval_terms).toLowerCase() === 'on';

  const missing = [
    ['Contact name', contactName],
    ['Organization or club name', organizationName],
    ['Email', email],
    ['Event name', eventName],
    ['Event date', eventDate],
    ['Event type', eventType],
    ['Estimated entries', estimatedEntries],
    ['Number of show sanctions', showSanctions],
    ['Payment method', paymentMethod],
  ].filter(([, value]) => !value).map(([label]) => label);

  if (missing.length > 0) {
    return jsonResponse({
      error: `Missing required fields: ${missing.join(', ')}.`,
    }, 400);
  }

  if (!isValidEmail(email)) {
    return jsonResponse({ error: 'Please enter a valid email address.' }, 400);
  }

  if (!approvalTerms) {
    return jsonResponse({
      error: 'The approval acknowledgement is required.',
    }, 400);
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const toEmail = Deno.env.get('YOUTH_DISCOUNT_REQUEST_TO');
  const fromEmail = Deno.env.get('YOUTH_DISCOUNT_REQUEST_FROM') ??
    'RingMaster One <noreply@ringmasterone.com>';

  if (!resendApiKey || !toEmail) {
    console.error('Missing RESEND_API_KEY or YOUTH_DISCOUNT_REQUEST_TO.');
    return jsonResponse({
      error: 'Request email is not configured yet.',
    }, 500);
  }

  const submittedAt = new Date().toLocaleString('en-US', {
    timeZone: 'America/Indiana/Indianapolis',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#18212b;line-height:1.45;">
      <h1 style="color:#082640;margin:0 0 8px;">Youth &amp; 4-H Discount Request</h1>
      <p style="margin:0 0 18px;color:#5d6b78;">Submitted ${escapeHtml(submittedAt)}</p>
      <table style="border-collapse:collapse;width:100%;max-width:760px;border:1px solid #d9e2ea;">
        ${row('Contact name', contactName)}
        ${row('Organization or club', organizationName)}
        ${row('Email', email)}
        ${row('Phone', phone)}
        ${row('Event name', eventName)}
        ${row('Event date', eventDate)}
        ${row('Event type', eventType)}
        ${row('Estimated entries', estimatedEntries)}
        ${row('Number of show sanctions', showSanctions)}
        ${row('Entry close date', entryCloseDate)}
        ${row('Payment method', paymentMethod)}
        ${row('Requested discount or budget', requestedDiscount)}
        ${row('Additional notes', notes)}
      </table>
    </div>
  `;

  const text = [
    'Youth & 4-H Discount Request',
    `Submitted: ${submittedAt}`,
    '',
    `Contact name: ${contactName}`,
    `Organization or club: ${organizationName}`,
    `Email: ${email}`,
    `Phone: ${phone || 'Not provided'}`,
    `Event name: ${eventName}`,
    `Event date: ${eventDate}`,
    `Event type: ${eventType}`,
    `Estimated entries: ${estimatedEntries}`,
    `Number of show sanctions: ${showSanctions}`,
    `Entry close date: ${entryCloseDate || 'Not provided'}`,
    `Payment method: ${paymentMethod}`,
    `Requested discount or budget: ${requestedDiscount || 'Not provided'}`,
    `Additional notes: ${notes || 'Not provided'}`,
  ].join('\n');

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      reply_to: email,
      subject: `Youth discount request: ${eventName}`,
      html,
      text,
    }),
  });

  if (!resendResponse.ok) {
    const detail = await resendResponse.text();
    console.error('Resend email failed:', detail);
    return jsonResponse({
      error: 'The request could not be sent. Please try again later.',
    }, 502);
  }

  return jsonResponse({ ok: true });
});
