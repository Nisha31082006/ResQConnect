import { env } from '../config/env';
import { Emergency, User } from '../models';
import { createEmergencyDoc, emitEmergencyEvent } from '../services/emergency.service';
import { detectDuplicates } from '../services/duplicate.service';
import { notifyRoles } from '../services/notification.service';
import { AppError, forbidden } from '../utils/AppError';
import { pointFrom } from '../utils/geo';
import { asyncHandler, created, ok } from '../utils/http';
import { EMERGENCY_TYPES } from '../models/shared';

/**
 * OPTIONAL inbound-SMS integration point.
 *
 * ResQConnect does not send or receive SMS by itself: the citizen-side "SMS fallback" only opens the phone's SMS
 * composer with a prepared message - nobody can know from the browser whether it was sent or delivered.
 *
 * If you connect an SMS gateway (Twilio, Textlocal, Kaleyra, ...), configure it to POST here with header
 * `x-sms-secret: <SMS_INBOUND_SECRET>` and a JSON body { from, body, messageId? }.
 * Messages must follow the format produced by the app:
 *   RESQ <TYPE> <PEOPLE> <LAT>,<LNG> <free text>      e.g.  RESQ FLOOD 4 13.0827,80.2707 water rising
 * Anything that cannot be parsed is stored as an "other" report at an unknown location is NOT created - it is rejected
 * so that no report with invented coordinates is ever stored.
 */
export function parseInboundSms(body: string): { type: string; affected: number; lat: number; lng: number; text: string } | null {
  const m = body.trim().match(/^RESQ\s+([A-Za-z_]+)\s+(\d{1,5})\s+(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*(.*)$/is);
  if (!m) return null;
  const type = m[1].toLowerCase();
  const lat = Number(m[3]);
  const lng = Number(m[4]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { type: (EMERGENCY_TYPES as readonly string[]).includes(type) ? type : 'other', affected: Math.max(1, Number(m[2])), lat, lng, text: m[5].trim() };
}

export const inboundSms = asyncHandler(async (req, res) => {
  if (!env.smsInboundSecret) throw new AppError(501, 'SMS_INBOUND_NOT_CONFIGURED', 'Inbound SMS processing is not configured on this server');
  if (req.header('x-sms-secret') !== env.smsInboundSecret) throw forbidden('SMS_SECRET_INVALID', 'Invalid SMS webhook secret');
  const { from, body, messageId } = req.body as { from: string; body: string; messageId?: string };
  const parsed = parseInboundSms(body);
  if (!parsed) return ok(res, { accepted: false, reason: 'UNPARSEABLE_FORMAT' });

  const clientRequestId = `sms-${messageId ?? `${from}-${Buffer.from(body).toString('base64').slice(0, 24)}`}`.slice(0, 80);
  const existing = await Emergency.findOne({ clientRequestId });
  if (existing) return ok(res, { accepted: true, duplicate: true, emergencyId: existing.emergencyId });

  const reporter = await User.findOne({ phone: from, role: 'citizen' }).select('_id');
  const em = await createEmergencyDoc({
    kind: 'sos',
    source: 'sms',
    clientRequestId,
    type: parsed.type as never,
    description: parsed.text || `SMS report (${parsed.type})`,
    affectedCount: parsed.affected,
    dangerToLife: true,
    severity: 'high',
    contact: { phone: from },
    location: pointFrom({ lat: parsed.lat, lng: parsed.lng }),
    reporter: reporter?._id,
  });
  await detectDuplicates(em);
  await notifyRoles(['admin'], { type: 'sos_created', params: { emergencyId: em.emergencyId, type: em.type, affected: em.affectedCount }, message: `SOS ${em.emergencyId} received by SMS`, link: `/admin/emergencies/${em._id}`, entityType: 'emergency', entityId: String(em._id) });
  await emitEmergencyEvent(em, 'sos:created');
  return created(res, { accepted: true, emergencyId: em.emergencyId });
});
