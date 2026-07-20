module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "EJE 2026 <onboarding@resend.dev>";
  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
  const notifyEmail = clean(body.notifyEmail || "");
  const to = notifyEmail || process.env.ADMIN_NOTIFY_EMAIL;

  if (!apiKey || !to) {
    return res.status(200).json({ ok: false, skipped: true, error: "Email environment variables missing" });
  }

  const userName = clean(body.userName || "Participante");
  const userEmail = clean(body.userEmail || "");
  const blockTitle = clean(body.blockTitle || "Bloque sin nombre");
  const resourceLabel = clean(body.resourceLabel || "Juego Wordwall");
  const exerciseTitle = clean(body.exerciseTitle || body.exerciseId || "Sin ejercicio vinculado");
  const playedAt = body.playedAt ? new Date(body.playedAt) : new Date();
  const playedLabel = Number.isNaN(playedAt.getTime())
    ? ""
    : playedAt.toLocaleString("es-PE", { timeZone: "America/Lima" });

  const subject = `EJE 2026: ${userName} aviso que ya jugo`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#172033">
      <h2 style="margin:0 0 12px">Aviso de juego Wordwall</h2>
      <p><b>${escapeHtml(userName)}</b> aviso que ya jugo y necesita actualizacion de resultados.</p>
      <table style="border-collapse:collapse;margin-top:12px">
        ${row("Participante", userName)}
        ${row("Correo", userEmail || "No registrado")}
        ${row("Bloque", blockTitle)}
        ${row("Juego", resourceLabel)}
        ${row("Ejercicio podio", exerciseTitle)}
        ${row("Fecha", playedLabel)}
      </table>
      <p style="margin-top:16px;color:#5b6680">Entra a Administracion > Avisos juegos, actualiza resultados con Excel o pegado rapido y marca el aviso como actualizado.</p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return res.status(200).json({ ok: false, error: text || "Email provider failed" });
  }

  return res.status(200).json({ ok: true });
};

function clean(value) {
  return String(value || "").trim().slice(0, 220);
}

function safeJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function row(label, value) {
  return `
    <tr>
      <td style="padding:6px 12px 6px 0;color:#68738f">${escapeHtml(label)}</td>
      <td style="padding:6px 0;font-weight:700">${escapeHtml(value)}</td>
    </tr>
  `;
}
