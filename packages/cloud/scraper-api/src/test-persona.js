/**
 * test-persona.js — Synthetic test persona generator.
 *
 * Generates realistic but fake personal data for form testing.
 * The agent uses this data to fill out forms during visual scans,
 * but NEVER submits the final conversion form.
 *
 * All data is obviously fake if inspected (test domains, 555 phone numbers, etc.)
 * but realistic enough to pass form validation.
 */

// Pools of realistic test data
const FIRST_NAMES = ["James", "Sarah", "Michael", "Emily", "David", "Jessica", "Robert", "Ashley", "William", "Amanda"];
const LAST_NAMES = ["Anderson", "Thompson", "Martinez", "Robinson", "Williams", "Johnson", "Taylor", "Brown", "Garcia", "Miller"];
const STREETS = ["123 Oak Street", "456 Maple Avenue", "789 Cedar Lane", "321 Pine Road", "654 Elm Drive", "987 Birch Court"];
const CITIES = [
  { city: "Austin", state: "TX", zip: "78701" },
  { city: "Denver", state: "CO", zip: "80202" },
  { city: "Portland", state: "OR", zip: "97201" },
  { city: "Nashville", state: "TN", zip: "37201" },
  { city: "Charlotte", state: "NC", zip: "28202" },
  { city: "Phoenix", state: "AZ", zip: "85001" },
  { city: "Atlanta", state: "GA", zip: "30301" },
  { city: "Raleigh", state: "NC", zip: "27601" },
];
const EMPLOYERS = ["Acme Corp", "Summit Industries", "Greenfield LLC", "Apex Solutions", "Beacon Group"];
const JOB_TITLES = ["Software Engineer", "Marketing Manager", "Account Executive", "Project Manager", "Operations Analyst"];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a complete synthetic test persona.
 * All data passes basic validation but is clearly synthetic on inspection.
 *
 * @param {Object} [overrides] - Override specific fields
 * @returns {Object} Complete persona with all common form fields
 */
export function generateTestPersona(overrides = {}) {
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const location = pick(CITIES);
  const birthYear = randomBetween(1970, 1995);
  const birthMonth = String(randomBetween(1, 12)).padStart(2, "0");
  const birthDay = String(randomBetween(1, 28)).padStart(2, "0");

  const persona = {
    // Identity
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@testfairy.example.com`,
    phone: `555-${randomBetween(100, 999)}-${randomBetween(1000, 9999)}`,
    dateOfBirth: `${birthMonth}/${birthDay}/${birthYear}`,
    birthMonth,
    birthDay,
    birthYear: String(birthYear),
    age: new Date().getFullYear() - birthYear,

    // Address
    street: pick(STREETS),
    address: pick(STREETS),
    city: location.city,
    state: location.state,
    zip: location.zip,
    zipCode: location.zip,

    // Financial (common for lending/insurance forms)
    annualIncome: String(randomBetween(45, 150) * 1000),
    monthlyIncome: String(Math.round(randomBetween(45, 150) * 1000 / 12)),
    creditScore: pick(["Good", "Very Good", "Excellent", "Fair"]),
    creditScoreRange: pick(["660-719", "720-779", "780-850", "620-659"]),
    employmentStatus: "Employed",
    employer: pick(EMPLOYERS),
    jobTitle: pick(JOB_TITLES),
    yearsEmployed: String(randomBetween(1, 15)),
    monthlyRent: String(randomBetween(800, 2500)),
    homeOwnership: pick(["Rent", "Own", "Mortgage"]),

    // Loan-specific
    loanAmount: String(randomBetween(5, 50) * 1000),
    loanPurpose: pick(["Debt Consolidation", "Home Improvement", "Major Purchase", "Medical"]),
    propertyValue: String(randomBetween(150, 600) * 1000),
    downPayment: String(randomBetween(10, 100) * 1000),

    // Insurance-specific
    vehicleYear: String(randomBetween(2018, 2025)),
    vehicleMake: pick(["Toyota", "Honda", "Ford", "Chevrolet", "Hyundai"]),
    vehicleModel: pick(["Camry", "Civic", "F-150", "Malibu", "Tucson"]),

    // SSN — use obviously fake pattern that passes format validation
    // 900-999 range is reserved and never issued by SSA
    ssn: `9${randomBetween(10, 99)}-${randomBetween(10, 99)}-${randomBetween(1000, 9999)}`,
    last4ssn: String(randomBetween(1000, 9999)),
  };

  return { ...persona, ...overrides };
}

/**
 * Match a form field to the best persona value.
 * Uses field name, label, placeholder, and type to determine what data to enter.
 *
 * @param {Object} fieldInfo - Info about the form field
 * @param {string} fieldInfo.name - Input name attribute
 * @param {string} fieldInfo.label - Associated label text
 * @param {string} fieldInfo.placeholder - Placeholder text
 * @param {string} fieldInfo.type - Input type
 * @param {string} fieldInfo.id - Input ID
 * @param {Object} persona - The test persona
 * @returns {string|null} The value to enter, or null if no match
 */
export function matchFieldToPersona(fieldInfo, persona) {
  const { name = "", label = "", placeholder = "", type = "", id = "" } = fieldInfo;
  const combined = `${name} ${label} ${placeholder} ${id}`.toLowerCase();

  // Email
  if (type === "email" || combined.includes("email")) return persona.email;

  // Phone
  if (type === "tel" || combined.includes("phone") || combined.includes("mobile") || combined.includes("cell")) return persona.phone;

  // Name fields
  if (combined.includes("first") && combined.includes("name")) return persona.firstName;
  if (combined.includes("last") && combined.includes("name")) return persona.lastName;
  if (combined.includes("full") && combined.includes("name")) return persona.fullName;
  if (combined.match(/\bname\b/) && !combined.includes("company") && !combined.includes("employer")) return persona.fullName;

  // Date of birth
  if (combined.includes("birth") || combined.includes("dob")) return persona.dateOfBirth;
  if (combined.includes("birth") && combined.includes("year")) return persona.birthYear;
  if (combined.includes("birth") && combined.includes("month")) return persona.birthMonth;
  if (combined.includes("birth") && combined.includes("day")) return persona.birthDay;
  if (combined.match(/\bage\b/)) return String(persona.age);

  // Address
  if (combined.includes("street") || combined.includes("address line") || combined.match(/\baddress\b/)) return persona.street;
  if (combined.match(/\bcity\b/)) return persona.city;
  if (combined.match(/\bstate\b/) || combined.match(/\bprovince\b/)) return persona.state;
  if (combined.match(/\bzip\b/) || combined.match(/\bpostal\b/)) return persona.zip;

  // Financial
  if (combined.includes("income") && combined.includes("annual")) return persona.annualIncome;
  if (combined.includes("income") || combined.includes("salary")) return persona.annualIncome;
  if (combined.includes("employer") || combined.includes("company name")) return persona.employer;
  if (combined.includes("job") || combined.includes("title") || combined.includes("occupation")) return persona.jobTitle;
  if (combined.includes("rent") && combined.includes("month")) return persona.monthlyRent;
  if (combined.includes("loan") && combined.includes("amount")) return persona.loanAmount;
  if (combined.includes("property") && combined.includes("value")) return persona.propertyValue;
  if (combined.includes("down") && combined.includes("payment")) return persona.downPayment;
  if (combined.includes("years") && (combined.includes("employ") || combined.includes("work"))) return persona.yearsEmployed;

  // SSN (use with caution — only fill if explicitly asked)
  if (combined.includes("ssn") || combined.includes("social security")) return persona.ssn;
  if (combined.includes("last 4") || combined.includes("last four")) return persona.last4ssn;

  // Vehicle
  if (combined.includes("vehicle") && combined.includes("year")) return persona.vehicleYear;
  if (combined.includes("make")) return persona.vehicleMake;
  if (combined.includes("model")) return persona.vehicleModel;

  return null;
}

/**
 * Detect if a button/link is a final form submission (the one we should NOT click).
 * We want to fill forms but stop before the final "Submit Application" / "Get Offers" etc.
 *
 * @param {string} buttonText - The text of the button
 * @param {Object} context - Page context
 * @returns {boolean} True if this looks like a final submit we should avoid
 */
export function isFinalSubmit(buttonText, context = {}) {
  const lower = (buttonText || "").toLowerCase().trim();

  // Explicit final submission patterns
  const finalPatterns = [
    "submit application", "submit my application", "get my offers",
    "get offers", "see my results", "see my rates", "see results",
    "complete application", "finish application", "submit request",
    "place order", "complete purchase", "confirm purchase",
    "apply now", "submit", "complete", "finish",
    "authorize", "agree and submit", "agree & submit",
    "sign up", "create account", "register",
    "get my quote", "get quote", "see my quote",
  ];

  // These are OK to click (intermediate steps)
  const safePatterns = [
    "next", "continue", "proceed", "next step", "go to next",
    "compare rates", "check rates", "see options", "get started",
    "begin", "start", "let's go", "find out",
  ];

  // If it matches a safe pattern, allow it
  if (safePatterns.some(p => lower.includes(p))) return false;

  // If it matches a final pattern, block it
  if (finalPatterns.some(p => lower === p || lower.includes(p))) return true;

  // If the button is type="submit" and we're deep in a form (many steps), be cautious
  if (context.stepsCompleted > 5 && lower.length < 20) {
    // Short button text late in a funnel — could be final submit
    if (["submit", "apply", "done", "finish", "complete"].some(w => lower.includes(w))) return true;
  }

  return false;
}
