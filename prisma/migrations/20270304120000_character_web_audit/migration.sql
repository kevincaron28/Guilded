-- Audit entries for the website's Make main and Unlink buttons on My Guilded (docs/plans/V9_4_PLAN.md T8B).
ALTER TYPE "AuditAction" ADD VALUE 'CHARACTER_MAIN_SET';
ALTER TYPE "AuditAction" ADD VALUE 'CHARACTER_UNLINKED_WEB';
