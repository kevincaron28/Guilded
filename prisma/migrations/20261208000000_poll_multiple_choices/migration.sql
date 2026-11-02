-- Polls can allow several picks per member (professions: two primary, three secondary).
ALTER TABLE "Poll" ADD COLUMN "maxChoices" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "PollVote_pollId_memberId_key";
CREATE UNIQUE INDEX "PollVote_pollId_memberId_option_key" ON "PollVote"("pollId", "memberId", "option");
