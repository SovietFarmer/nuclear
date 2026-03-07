import objMgr, { me } from './ObjectManager';
import { drHelpers } from '../Data/PVPDRList';
import { CombatLogEventTypes } from '../Enums/CombatLogEvents';
import Settings from './Settings';

/**
 * Diminishing Returns Tracker for PvP
 * Tracks DR state for enemy players using combat log events
 */
class DRTracker extends wow.EventListener {
  constructor() {
    super();
    this.enabled = true;
    this.drData = new Map(); // guidHash -> { category -> { stacks, endTime } }
    this.ccData = new Map(); // guidHash -> { spellId -> { category, appliedTime } }
    this.nameCache = new Map(); // guidHash -> last known unit name
    this.drTimeout = 22000; // 22 seconds in milliseconds (Midnight: 16s reset + ~6s CC buffer)
    this.drResetTime = 16500; // 16.5 seconds in milliseconds (Midnight: 16s + 0.5s latency)
    this.debugLogs = false;
  }

  /**
   * Initialize the DR tracker
   */
  initialize() {
    console.log('DR Tracker initialized');
    this.debugLogs = Settings.DRTrackerDebugLogs || false;
  }

  /**
   * Debug logging method
   */
  debugLog(message) {
    if (this.debugLogs) {
      console.info(message);
    }
  }

  /**
   * Handle combat log events
   */
  onEvent(event) {
    if (!this.enabled) return;

    if (event.name === "COMBAT_LOG_EVENT_UNFILTERED") {
      this.processCombatLogEvent(event);
    }
  }

  /**
   * Process combat log events for DR tracking
   */
  processCombatLogEvent(event) {
    try {
      // Extract event data - need to check if it's nested in args[0] or direct
      const eventData = event.args?.[0] || event;
      const eventType = eventData.eventType;
      const spellId = eventData.args?.[0] || eventData.spellId;
      const targetGuid = eventData.target?.guid || eventData.destination?.guid;

      // Track events on any player (including me)
      if (!targetGuid || !this.isPlayerUnit(targetGuid)) return;

      // Check if this spell has a DR category
      const category = drHelpers.getCategoryBySpellID(spellId);
      if (!category) return;

      const currentTime = Date.now();

      // Handle DR-relevant events using eventType numbers
      switch (eventType) {
        case CombatLogEventTypes.SPELL_AURA_APPLIED:
        case CombatLogEventTypes.SPELL_AURA_REFRESH:
          this.applyDR(targetGuid, category, spellId, currentTime);
          break;
        case CombatLogEventTypes.SPELL_AURA_REMOVED:
          this.fadeDR(targetGuid, category, spellId, currentTime, "faded");
          break;
        case CombatLogEventTypes.SPELL_AURA_BROKEN:
        case CombatLogEventTypes.SPELL_AURA_BROKEN_SPELL:
          this.fadeDR(targetGuid, category, spellId, currentTime, "broken");
          break;
        case CombatLogEventTypes.SPELL_MISSED: {
          const missType = eventData.args?.[1];
          if (missType === "IMMUNE") {
            this.applyImmune(targetGuid, category, spellId, currentTime);
          }
          break;
        }
      }
    } catch (error) {
      console.error('DRTracker processCombatLogEvent error:', error);
    }
  }

  /**
   * Check if a GUID belongs to any player unit
   */
  isPlayerUnit(guid) {
    try {
      const unit = objMgr.findObject(guid);
      return unit && unit.isPlayer();
    } catch (error) {
      // If there's an error checking if unit is a player, assume it's not
      return false;
    }
  }

  /**
   * Main update loop - should be called every frame
   */
  update() {
    if (!this.enabled) return;

    try {
      const currentTime = Date.now();

      // Clean up expired DR entries
      for (const [guidHash, unitDRData] of this.drData) {
        for (const [category, drInfo] of Object.entries(unitDRData)) {
          if (drInfo.endTime && currentTime > drInfo.endTime) {
            const wasImmune = drInfo.stacks >= 2;
            const name = this.getUnitNameByHash(guidHash);
            const status = wasImmune ? "was IMMUNE" : `was ${drInfo.stacks}/2`;
            this.debugLog(`[DR] ${name} ${category} RESET — ${status}, now CC-able`);
            delete unitDRData[category];
          }
        }

        // Remove unit data if no active DRs
        if (Object.keys(unitDRData).length === 0) {
          this.drData.delete(guidHash);
        }
      }
    } catch (error) {
      console.error('DRTracker update error:', error);
    }
  }

  /**
   * Apply DR when a CC spell is cast
   */
  applyDR(unitGuid, category, spellId, currentTime) {
    const guidHash = unitGuid.hash;

    if (!this.drData.has(guidHash)) {
      this.drData.set(guidHash, {});
    }

    const unitDRData = this.drData.get(guidHash);

    if (!unitDRData[category]) {
      unitDRData[category] = { stacks: 0, endTime: 0 };
    }

    const drInfo = unitDRData[category];
    drInfo.stacks = Math.min(drInfo.stacks + 1, 2); // Max 2 stacks (immune) — Midnight
    drInfo.endTime = currentTime + this.drTimeout;

    this.addActiveCC(unitGuid, spellId, category, currentTime);

    const tag = drInfo.stacks >= 2 ? " IMMUNE" : "";
    this.debugLog(`[DR] ${this.getUnitName(unitGuid)} has ${drInfo.stacks}/2${tag} ${category} (spell ${spellId})`);
  }

  /**
   * Handle DR fade when CC spell ends
   */
  fadeDR(unitGuid, category, spellId, currentTime, reason = "faded") {
    const guidHash = unitGuid.hash;
    const unitDRData = this.drData.get(guidHash);
    if (!unitDRData || !unitDRData[category]) return;

    const drInfo = unitDRData[category];
    drInfo.endTime = currentTime + this.drResetTime;

    this.removeActiveCCByCategory(unitGuid, category);
    if (spellId) this.removeActiveCC(unitGuid, spellId);

    const status = drInfo.stacks >= 2 ? "IMMUNE" : `${drInfo.stacks}/2`;
    this.debugLog(`[DR] ${this.getUnitName(unitGuid)} ${category} ${reason} — still ${status}, resets ${(this.drResetTime / 1000).toFixed(1)}s (spell ${spellId})`);
  }

  /**
   * Force a category to immune stacks (used when server confirms IMMUNE via SPELL_MISSED)
   */
  applyImmune(unitGuid, category, spellId, currentTime) {
    const guidHash = unitGuid.hash;

    if (!this.drData.has(guidHash)) {
      this.drData.set(guidHash, {});
    }

    const unitDRData = this.drData.get(guidHash);

    if (!unitDRData[category]) {
      unitDRData[category] = { stacks: 0, endTime: 0 };
    }

    const drInfo = unitDRData[category];
    const wasSynced = drInfo.stacks < 2;
    drInfo.stacks = 2;
    drInfo.endTime = currentTime + this.drTimeout;

    const syncNote = wasSynced ? " (synced from server)" : "";
    this.debugLog(`[DR] ${this.getUnitName(unitGuid)} is IMMUNE to ${category}${syncNote} (spell ${spellId})`);
  }

  /**
   * Get unit name by GUID (caches for later use in update loop)
   */
  getUnitName(unitGuid) {
    const unit = objMgr.findObject(unitGuid);
    const name = unit ? unit.unsafeName : 'Unknown';
    if (unitGuid?.hash) {
      this.nameCache.set(unitGuid.hash, name);
    }
    return name;
  }

  /**
   * Get cached unit name by guid hash (for update loop where we only have the hash)
   */
  getUnitNameByHash(guidHash) {
    return this.nameCache.get(guidHash) || 'Unknown';
  }

  /**
   * Add active CC tracking
   */
  addActiveCC(unitGuid, spellId, category, currentTime) {
    const guidHash = unitGuid.hash;

    if (!this.ccData.has(guidHash)) {
      this.ccData.set(guidHash, {});
    }

    const unitCCData = this.ccData.get(guidHash);
    unitCCData[spellId] = { category, appliedTime: currentTime };
  }

  /**
   * Remove active CC by spell ID
   */
  removeActiveCC(unitGuid, spellId) {
    const guidHash = unitGuid.hash;
    const unitCCData = this.ccData.get(guidHash);
    if (!unitCCData || !unitCCData[spellId]) return;

    delete unitCCData[spellId];

    // Remove unit data if no active CCs
    if (Object.keys(unitCCData).length === 0) {
      this.ccData.delete(guidHash);
    }
  }

  /**
   * Remove active CC by category (when DR fades)
   */
  removeActiveCCByCategory(unitGuid, category) {
    const guidHash = unitGuid.hash;
    const unitCCData = this.ccData.get(guidHash);
    if (!unitCCData) return;

    // Find and remove all CCs of this category
    const spellsToRemove = [];
    for (const [spellId, ccInfo] of Object.entries(unitCCData)) {
      if (ccInfo.category === category) {
        spellsToRemove.push(spellId);
      }
    }

    spellsToRemove.forEach(spellId => {
      delete unitCCData[spellId];
    });

    // Remove unit data if no active CCs
    if (Object.keys(unitCCData).length === 0) {
      this.ccData.delete(guidHash);
    }
  }

  /**
   * Check if a unit is currently CCd
   */
  isCCd(unitGuid) {
    const guidHash = unitGuid.hash;
    const unitCCData = this.ccData.get(guidHash);
    return !!(unitCCData && Object.keys(unitCCData).length > 0);
  }

  /**
   * Check if a unit is CCd by a specific category
   */
  isCCdByCategory(unitGuid, category) {
    const guidHash = unitGuid.hash;
    const unitCCData = this.ccData.get(guidHash);
    if (!unitCCData) return false;

    return Object.values(unitCCData).some(ccInfo => ccInfo.category === category);
  }

  /**
   * Get all active CCs for a unit
   */
  getActiveCCs(unitGuid) {
    const guidHash = unitGuid.hash;
    return this.ccData.get(guidHash) || {};
  }

  /**
   * Get DR stacks for a unit and category
   */
  getDRStacks(unitGuid, category) {
    const guidHash = unitGuid.hash;
    const unitDRData = this.drData.get(guidHash);
    if (!unitDRData || !unitDRData[category]) return 0;
    return unitDRData[category].stacks;
  }

  /**
   * Get DR stacks for a unit and spell ID
   */
  getDRStacksBySpell(unitGuid, spellId) {
    const category = drHelpers.getCategoryBySpellID(spellId);
    if (!category) return 0;
    return this.getDRStacks(unitGuid, category);
  }

  /**
   * Check if a spell would be diminished on a target
   */
  wouldBeDiminished(unitGuid, spellId) {
    return this.getDRStacksBySpell(unitGuid, spellId) > 0;
  }

  /**
   * Check if a target is immune to a spell category
   */
  isImmune(unitGuid, spellId) {
    return this.getDRStacksBySpell(unitGuid, spellId) >= 2;
  }

  /**
   * Get the diminished duration multiplier for a spell
   */
  getDiminishedMultiplier(unitGuid, spellId) {
    const category = drHelpers.getCategoryBySpellID(spellId);
    if (!category) return 1.0;

    const stacks = this.getDRStacks(unitGuid, category);
    return drHelpers.getNextDR(stacks, category);
  }

  /**
   * Get all DR data for a unit
   */
  getUnitDRData(unitGuid) {
    const guidHash = unitGuid.hash;
    return this.drData.get(guidHash) || {};
  }

  /**
   * Enable/disable the tracker
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.drData.clear();
      this.ccData.clear();
      this.nameCache.clear();
    }
  }

  /**
   * Reset all DR data
   */
  reset() {
    this.drData.clear();
    this.ccData.clear();
    this.nameCache.clear();
  }
}

// Create singleton instance
const drTracker = new DRTracker();

export default drTracker;
