import type { JobStepDefinition, JobStepResult, VerificationHook } from "@/lib/ai/jobs/types";

/**
 * ONDEAL AI JOB ENGINE — hooks de vérification (06/09/2026), fondation §9.
 *
 * Aucun vérificateur "réel" ici (typecheck/lint/test/build ne peuvent pas
 * tourner à l'intérieur d'une fonction serverless sur le code du dépôt lui-
 * même — ça reste une étape de CI séparée, voir l'audit §14). Ce fichier ne
 * fournit qu'un vérificateur trivial, utile pour les tests de cette
 * fondation et comme exemple de forme pour un futur vérificateur réel
 * (ex. un vérificateur qui rejoue un test Vitest précis sur une sortie de
 * step de type "code généré").
 */
export const nonEmptyOutputVerifier: VerificationHook = {
  name: "non_empty_output",
  async verify(_step: JobStepDefinition, result: JobStepResult) {
    const isEmpty = result.output === null || result.output === undefined || result.output === "";
    return isEmpty ? { pass: false, reason: "Sortie de step vide." } : { pass: true };
  },
};
