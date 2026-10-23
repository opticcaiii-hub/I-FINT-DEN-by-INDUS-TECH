/**
 * lib/feature-flags.ts
 *
 * Centralized feature flags for I-FINT platform.
 * All feature flags default to false unless explicitly enabled with 'true'.
 */

export function isWhatsAppBotEnabled(): boolean {
  return process.env.WHATSAPP_BOT_ENABLED === 'true';
}

export function isFbrLiveSubmissionEnabled(): boolean {
  return process.env.FBR_LIVE_SUBMISSION_ENABLED === 'true';
}

export function isAiFeaturesEnabled(): boolean {
  return process.env.AI_FEATURES_ENABLED === 'true';
}

export function getPublicFeatureFlags() {
  return {
    WHATSAPP_BOT_ENABLED: isWhatsAppBotEnabled(),
    FBR_LIVE_SUBMISSION_ENABLED: isFbrLiveSubmissionEnabled(),
    AI_FEATURES_ENABLED: isAiFeaturesEnabled(),
  };
}
