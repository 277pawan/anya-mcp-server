export class CategorySelector {
  static CATEGORIES = {
    HEALTH: "Health",
    MIND: "Mind",
    BUSINESS: "Business",
    TECH: "Tech",
    BODY: "Body"
  };

  static NUDGE_TYPES = {
    NORMAL: "normal",
    BIG_QUESTION: "big_question", // Morning
    RABBIT_HOLE: "rabbit_hole",   // Occasional deep dive
    STREAK_NUDGE: "streak_nudge"  // Occasional
  };

  /**
   * Determine the current time phase based on user's timezone/local time.
   */
  static getTimePhase(hour) {
    if (hour >= 6 && hour < 11) return "morning"; // Cortisol peak
    if (hour >= 11 && hour < 16) return "afternoon"; // Energy dips
    if (hour >= 16 && hour < 22) return "evening"; // Wind down/reflection
    return "night";
  }

  /**
   * Selects the best category and type of nudge for the current moment.
   * Uses Layer 1 (Time), Layer 2 (Category), Layer 3 (Rotation), and Layer 6 (Body-clock).
   */
  static selectNudge(userState) {
    const currentHour = new Date().getHours();
    const phase = this.getTimePhase(currentHour);
    
    // Recent categories to avoid repeating (Rotation Intelligence)
    const recentCategories = (userState.receivedNudges || [])
      .slice(-2) // Look at last 2 nudges
      .map(n => n.category);

    let allowedCategories = [];
    let nudgeType = this.NUDGE_TYPES.NORMAL;

    // Time-based intelligence (Layer 1 & 6)
    if (phase === "morning") {
      allowedCategories = [this.CATEGORIES.MIND, this.CATEGORIES.BUSINESS];
      // 30% chance for a "Big Question" in the morning
      if (Math.random() < 0.3) {
        nudgeType = this.NUDGE_TYPES.BIG_QUESTION;
      }
    } else if (phase === "afternoon") {
      allowedCategories = [this.CATEGORIES.HEALTH, this.CATEGORIES.BODY, this.CATEGORIES.TECH];
    } else if (phase === "evening") {
      allowedCategories = [this.CATEGORIES.MIND, this.CATEGORIES.TECH, this.CATEGORIES.BUSINESS];
      // 20% chance for a deep dive rabbit hole in the evening
      if (Math.random() < 0.2) {
        nudgeType = this.NUDGE_TYPES.RABBIT_HOLE;
      }
    } else {
      // Night time - usually shouldn't nudge, but if forced, focus on sleep/health
      allowedCategories = [this.CATEGORIES.HEALTH, this.CATEGORIES.MIND];
    }

    // Rotation filtering
    let availableCategories = allowedCategories.filter(c => !recentCategories.includes(c));
    
    // Fallback if rotation filters out everything
    if (availableCategories.length === 0) {
      availableCategories = allowedCategories;
    }

    // Pick a random category from the available ones
    const selectedCategory = availableCategories[Math.floor(Math.random() * availableCategories.length)];

    // Occasional streak nudge if they have a good streak (Layer 4/Personalization)
    if (userState.streak >= 5 && Math.random() < 0.1) {
      nudgeType = this.NUDGE_TYPES.STREAK_NUDGE;
    }

    return {
      category: selectedCategory,
      phase,
      type: nudgeType
    };
  }
}
