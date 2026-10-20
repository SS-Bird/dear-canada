// Short codes used by the pipelines → full titles. Add a line when a new book is processed;
// unknown codes still work, they just show the code.
export const BOOK_TITLES = {
  AinUTL: "Alone in an Untamed Land",
  AToBD: "A Trail of Broken Dreams",
  BFfH: "Brothers Far from Home",
  BUoL: "Blood Upon Our Land",
  CofOO: "A Country of Our Own",
  DofmyC: "The Death of My Country",
  DofTT: "Days of Toil and Tears",
  DRtoF: "A Desperate Road to Freedom",
  EftW: "Exiles from the War",
  FitS: "Footsteps in the Snow",
  NbutC: "With Nothing But Our Courage",
  NSH: "No Safe Harbour",
  OA: "An Ocean Apart",
  OatmyD: "Orphan at My Door",
  PasWide: "A Prairie as Wide as the Sea",
  PintPL: "Prisoners in the Promised Land",
  SofS: "A Sea of Sorrows",
  TA: "Torn Apart",
  TFN: "That Fatal Night",
  WofW: "Whispers of War",
};

export const bookTitle = code => BOOK_TITLES[code] || BOOK_TITLES[String(code).split("_")[0]] || code;
