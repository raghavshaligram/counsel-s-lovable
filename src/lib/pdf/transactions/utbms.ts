// UTBMS task & activity codes (partial standard set). Used to validate
// LEDES column mappings — if the "task_code" column is full of non-matches
// we know the mapping is wrong.

export const UTBMS_TASK_CODES = new Set<string>([
  // L100 Case Assessment
  "L110","L120","L130","L140","L150","L160","L190",
  // L200 Pre-Trial Pleadings and Motions
  "L210","L220","L230","L240","L250","L260","L270","L280","L290",
  // L300 Discovery
  "L310","L320","L330","L340","L350","L390",
  // L400 Trial Preparation and Trial
  "L410","L420","L430","L440","L450","L460","L470","L490",
  // L500 Appeal
  "L510","L520","L530","L540","L590",
  // Bankruptcy B100–B400 selection
  "B110","B120","B130","B140","B150","B160","B170","B180","B190",
  "B210","B220","B230","B240","B250","B260",
  "B310","B320",
  "B410","B420","B430","B440",
  // Counseling C100/C200
  "C100","C200","C300",
  // Project A-series
  "A101","A102","A103","A104","A105","A106","A107","A108","A109","A110","A111","A112",
]);

export const UTBMS_ACTIVITY_CODES = new Set<string>([
  "A101","A102","A103","A104","A105","A106","A107","A108","A109","A110","A111","A112",
]);

export const UTBMS_EXPENSE_CODES = new Set<string>([
  "E101","E102","E103","E104","E105","E106","E107","E108","E109","E110","E111","E112",
  "E113","E114","E115","E116","E117","E118","E119","E120","E121","E122","E123","E124","E125",
]);
