import { AppError } from '../errors.js';

const ticketView = (t) => ({
  id: t.id, category: t.category, subject: t.subject, description: t.description, status: t.status,
  ride_id: t.ride_id ?? null, created_at: t.created_at, updated_at: t.updated_at,
});
const updateView = (u) => ({ id: u.id, author: u.author, status: u.status ?? null, message: u.message, created_at: u.created_at });

export const DEMO_TRIAGE_NOTE = 'A Delta support agent is reviewing your request. (Demo build: this acknowledgement is automated.)';

/**
 * Support tickets stored in Supabase. Users only ever see their own tickets.
 * Status flow: open -> in_review -> resolved / closed. A user reply re-opens a resolved ticket.
 * Staff updates come from the support desk script (scripts/support-desk.js); in this demo build an
 * automated triage step moves new tickets to "in review" after a minute so status tracking is visible.
 */
export function createSupportService({ store, triageAfterSeconds = 60 }) {
  async function own(user, id) {
    const t = await store.getTicket(id);
    if (!t || t.user_id !== user.id) throw new AppError(404, 'TICKET_NOT_FOUND', 'Support request not found.');
    return t;
  }

  return {
    async create(user, { category, subject, description, ride_id }) {
      if (ride_id) {
        const ride = await store.getRide(ride_id);
        const mine = ride && (ride.passenger_id === user.id || (user.driver && ride.driver_id === user.driver.id));
        if (!mine) throw new AppError(404, 'RIDE_NOT_FOUND', 'Ride not found.');
      }
      const t = await store.insertTicket({ user_id: user.id, category, subject, description, ride_id: ride_id ?? null });
      await store.insertTicketUpdate({
        ticket_id: t.id, author: 'system', status: 'open',
        message: 'We’ve received your request. You can follow its status here.',
      });
      return { ticket: ticketView(t) };
    },

    async list(user) {
      return { tickets: (await store.listTickets(user.id)).map(ticketView) };
    },

    async get(user, id) {
      const t = await own(user, id);
      return { ticket: ticketView(t), updates: (await store.listTicketUpdates(t.id)).map(updateView) };
    },

    async reply(user, id, message) {
      const t = await own(user, id);
      if (t.status === 'closed') throw new AppError(409, 'TICKET_CLOSED', 'This request is closed. Open a new one if you still need help.');
      await store.insertTicketUpdate({ ticket_id: t.id, author: 'user', message });
      if (t.status === 'resolved') {
        await store.updateTicket(t.id, { status: 'open' });
        await store.insertTicketUpdate({ ticket_id: t.id, author: 'system', status: 'open', message: 'Re-opened after your reply.' });
      } else {
        await store.updateTicket(t.id, {}); // bump updated_at
      }
      return this.get(user, id);
    },

    async close(user, id) {
      const t = await own(user, id);
      if (t.status !== 'closed') {
        await store.updateTicket(t.id, { status: 'closed' });
        await store.insertTicketUpdate({ ticket_id: t.id, author: 'user', status: 'closed', message: 'Closed by you.' });
      }
      return this.get(user, id);
    },

    /** Staff action (support desk script / tests): set a status with a note the user will see. */
    async staffUpdate(id, status, message) {
      const t = await store.getTicket(id);
      if (!t) throw new AppError(404, 'TICKET_NOT_FOUND', 'Support request not found.');
      await store.updateTicket(t.id, { status });
      await store.insertTicketUpdate({ ticket_id: t.id, author: 'support', status, message });
      return ticketView(await store.getTicket(id));
    },

    /** Demo automation: acknowledge tickets that have waited `triageAfterSeconds`. */
    async autoTriage() {
      const cutoff = new Date(Date.now() - triageAfterSeconds * 1000).toISOString();
      const waiting = await store.listTicketsByStatus('open', cutoff);
      for (const t of waiting) await this.staffUpdate(t.id, 'in_review', DEMO_TRIAGE_NOTE);
      return waiting.length;
    },
  };
}
