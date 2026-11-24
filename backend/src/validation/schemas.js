import { z } from 'zod';
import { AppError } from '../errors.js';

const coord = (min, max) => z.number().finite().min(min).max(max);

export const locationSchema = z.object({
  address: z.string().trim().min(3, 'Address is required').max(300),
  latitude: coord(-90, 90),
  longitude: coord(-180, 180),
});

export const estimateSchema = z.object({ pickup: locationSchema, destination: locationSchema });

export const createRideSchema = estimateSchema.extend({
  idempotencyKey: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

export const availabilitySchema = z.object({ is_online: z.boolean() });

export const locationUpdateSchema = z.object({ latitude: coord(-90, 90), longitude: coord(-180, 180) });

export const onboardingSchema = z.object({
  role: z.enum(['passenger', 'driver']),
  phone: z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, 'Enter a valid phone number'),
  vehicle_model: z.string().trim().min(1).max(80).optional(),
  vehicle_registration: z.string().trim().min(1).max(20).optional(),
}).refine((v) => v.role !== 'driver' || (v.vehicle_model && v.vehicle_registration), {
  message: 'Vehicle model and registration are required for drivers',
  path: ['vehicle_model'],
});

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().datetime({ offset: true }).optional(),
});

export const profileUpdateSchema = z.object({
  full_name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, 'Enter a valid phone number').optional(),
  vehicle_model: z.string().trim().min(1).max(80).optional(),
  vehicle_registration: z.string().trim().min(1).max(20).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const idParamSchema = z.object({ id: z.string().uuid() });

// ---- Phase 2 ----
const phone = z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, 'Enter a valid phone number');
const optionalText = (max) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const messageSchema = z.object({ body: z.string().trim().min(1, 'Type a message').max(500) }).strict();

export const savedPlaceSchema = z.object({
  kind: z.enum(['home', 'work', 'other']).default('other'),
  label: z.string().trim().min(1).max(40),
  address: z.string().trim().min(3).max(300),
  latitude: coord(-90, 90),
  longitude: coord(-180, 180),
}).strict();
export const savedPlaceUpdateSchema = z.object({
  kind: z.enum(['home', 'work', 'other']).optional(),
  label: z.string().trim().min(1).max(40).optional(),
  address: z.string().trim().min(3).max(300).optional(),
  latitude: coord(-90, 90).optional(),
  longitude: coord(-180, 180).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), { message: 'Send latitude and longitude together' });

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone,
  relationship: optionalText(40),
}).strict();
export const contactUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  phone: phone.optional(),
  relationship: optionalText(40),
}).strict().refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' });

export const ticketSchema = z.object({
  category: z.enum(['ride_issue', 'fare', 'driver', 'lost_item', 'safety', 'general']),
  subject: z.string().trim().min(3, 'Add a short subject').max(120),
  description: z.string().trim().min(10, 'Tell us a little more (at least 10 characters)').max(2000),
  ride_id: z.string().uuid().nullish(),
}).strict();
export const ticketReplySchema = z.object({ message: z.string().trim().min(1).max(2000) }).strict();
export const alertActionSchema = z.object({ action: z.enum(['dismiss', 'help']) }).strict();

/** Parse or throw a 400 AppError with readable field messages. */
export function parse(schema, value) {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request.', details);
  }
  return result.data;
}
