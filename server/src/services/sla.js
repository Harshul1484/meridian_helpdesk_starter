import { config } from '../config.js';

/**
 * SLA breach evaluation.
 *
 * The response target for a ticket comes from its priority (config.slaTargets,
 * in hours). A ticket is "breached" when the time from creation to its first
 * agent/admin response exceeds that target - or, if it has not been responded
 * to yet, when the time from creation until now already exceeds it. Once a
 * ticket has been answered in time it can never become breached; once it has
 * missed the target the breach is permanent.
 *
 * The elapsed-seconds value and whether a response exists are computed in SQL
 * (see ticketService) so the list filter and pagination can work in one query;
 * this module owns the decision itself so the rule lives in exactly one place.
 */
export function slaTargetHours(priority) {
  return config.slaTargets[priority] ?? null;
}

export function evaluateSla({ priority, elapsedSeconds, responded }) {
  const targetHours = slaTargetHours(priority);
  const targetSeconds = targetHours == null ? null : targetHours * 3600;
  const elapsed = elapsedSeconds == null ? null : Number(elapsedSeconds);

  const breached =
    targetSeconds != null && elapsed != null && elapsed > targetSeconds;

  return {
    breached,
    responded: Boolean(responded),
    targetHours,
    // Whole hours on the SLA clock (creation -> first response, or -> now).
    // Informational, used for the badge tooltip on the detail page.
    elapsedHours: elapsed == null ? null : Math.floor(elapsed / 3600),
  };
}
