/**
console * Normalize various date formats to YYYY-MM-DD
 * Handles: "today", "tomorrow", "yesterday", "next friday",
 *          "April 25", "25th April", "2025-04-25", etc.
 */
function normalizeDate(dateInput) {
  if (!dateInput || dateInput === "today") {
    return new Date().toISOString().split("T")[0];
  }

  if (dateInput === "tomorrow") {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0];
  }

  if (dateInput === "yesterday") {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split("T")[0];
  }

  // Handle "next friday", "this monday", etc.
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const lowerInput = dateInput.toLowerCase();

  for (let i = 0; i < dayNames.length; i++) {
    if (lowerInput.includes(dayNames[i])) {
      const today = new Date();
      const currentDay = today.getDay();
      let targetDay = i;

      if (lowerInput.includes("next")) {
        targetDay = targetDay + 7;
      } else if (
        lowerInput.includes("last") ||
        lowerInput.includes("previous")
      ) {
        targetDay = targetDay - 7;
      } else if (targetDay <= currentDay && !lowerInput.includes("this")) {
        targetDay = targetDay + 7;
      }

      const diff = targetDay - currentDay;
      const targetDate = new Date();
      targetDate.setDate(today.getDate() + diff);
      return targetDate.toISOString().split("T")[0];
    }
  }

  // Handle "April 25", "25 April", "25th April 2025"
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];

  for (let i = 0; i < monthNames.length; i++) {
    if (lowerInput.includes(monthNames[i])) {
      const currentYear = new Date().getFullYear();
      const dayMatch = lowerInput.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
      const yearMatch = lowerInput.match(/\b(20\d{2})\b/);

      const month = i;
      const day = dayMatch ? parseInt(dayMatch[1]) : 1;
      const year = yearMatch ? parseInt(yearMatch[1]) : currentYear;

      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split("T")[0];
      }
    }
  }

  // Try parsing as standard date string
  const parsed = new Date(dateInput);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  // Default to today if all else fails
  console.warn(`Could not parse date: "${dateInput}", defaulting to today`);
  return new Date().toISOString().split("T")[0];
}
export default normalizeDate;
