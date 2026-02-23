import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultHealTargeting as h } from "@/Targeting/HealTargeting";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import { spellBlacklist } from "@/Data/PVPData";
import { pvpHelpers } from "@/Data/PVPData";
import drTracker from "@/Core/DRTracker";
import Settings from "@/Core/Settings";
import { PowerType } from "@/Enums/PowerType";
import { toastSuccess } from "@/Extra/ToastNotification";
import { KlassType } from "@/Enums/UnitEnums";

const auras = {
  painSuppression: 33206,
  powerOfTheDarkSide: 198068,
  shadowWordPain: 589,
  powerWordShield: 17,
  atonement: 194384,
  surgeOfLight: 114255,
  premonitionPiety: 428930,
  premonitionSolace: 428934,
  premonitionInsight: 428933,
  powerInfusion: 10060,
};

export class PriestDisciplinePvP extends Behavior {
  name = "Priest (Discipline) PVP";
  context = BehaviorContext.Any;
  specialization = Specialization.Priest.Discipline;

  // Define healTarget as a class property
  healTarget = null;

  // Defensive cooldown tracking
  lastDefensiveCooldownTime = 0;
  lastPainSuppressionTime = 0;
  lastVoidShiftTime = 0;
  lastBarrierTime = 0;

  // Enemy CC tracking for predictive Fade
  enemyCCTracker = new Map(); // Track enemy GUID -> { spellId: timestamp }

  static settings = [
    {
      header: "Defensive Cooldowns",
      options: [
        { type: "slider", uid: "PainSuppressionHealth", text: "Pain Suppression health threshold (%)", min: 30, max: 80, default: 55 },
        { type: "slider", uid: "VoidShiftHealth", text: "Void Shift health threshold (%)", min: 10, max: 50, default: 24 },
        { type: "slider", uid: "BarrierHealth", text: "Power Word: Barrier health threshold (%)", min: 30, max: 70, default: 50 },
        { type: "slider", uid: "DefensiveCooldownInterval", text: "Minimum seconds between defensive CDs", min: 3, max: 15, default: 8 },
        { type: "checkbox", uid: "UseSmartDefensiveCoordination", text: "Use smart defensive coordination", default: true }
      ]
    },
    {
      header: "Enhanced PVP Features",
      options: [
        { type: "checkbox", uid: "UseAdvancedShadowWordDeath", text: "Use Advanced Shadow Word: Death (any enemy in range)", default: true },
        { type: "checkbox", uid: "UseFadeForReflectSpells", text: "Use Fade for pvpReflect spells", default: true },
        { type: "checkbox", uid: "UsePreemptiveFade", text: "Use Preemptive Fade (predict enemy CC)", default: true },
        { type: "checkbox", uid: "UseSmartMindControl", text: "Use Smart Mind Control (enemy healer)", default: true },
        { type: "checkbox", uid: "UseMindControlDPS", text: "Mind Control enemy DPS with major cooldowns", default: false },
        { type: "checkbox", uid: "UseVoidTendrils", text: "Use Void Tendrils when 2+ enemies nearby", default: true },
        { type: "checkbox", uid: "UseAutoPowerInfusion", text: "Auto Power Infusion friends with major cooldowns", default: true }
      ]
    },
    {
      header: "Mind Control Conditions",
      options: [
        { type: "slider", uid: "MindControlHealthThreshold", text: "All friends must be above % health (healer MC)", min: 70, max: 95, default: 80 },
        { type: "slider", uid: "MindControlMaxDR", text: "Max Disorient DR on enemy healer", min: 0, max: 2, default: 1 },
        { type: "slider", uid: "MindControlDPSHealthThreshold", text: "All friends must be above % health (DPS MC)", min: 60, max: 90, default: 70 }
      ]
    },
    {
      header: "Power Infusion Settings",
      options: [
        { type: "slider", uid: "PowerInfusionMinDuration", text: "Minimum cooldown duration (seconds)", min: 3, max: 15, default: 5 },
        { type: "checkbox", uid: "PowerInfusionPrioritizeDPS", text: "Prioritize DPS classes over healers", default: true }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotWaitingForArenaToStart(),
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      this.waitForNotJustCastPenitence(),
      // Stop casting for CC counter - this needs to be outside GCD check
      new bt.Decorator(
        () => this.shouldStopCastingForCCCounter(),
        new bt.Action(_ => {
          me.stopCasting();
          console.log(`[Priest] Stopped casting to counter incoming CC`);
          return bt.Status.Success;
        })
      ),

      // Main behavior tree with GCD check
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          // High priority Shadow Word: Death for incoming CC
          spell.cast("Shadow Word: Death", on => this.findIncomingCCTarget(), ret =>
            this.findIncomingCCTarget() !== undefined && !spell.isOnCooldown("Shadow Word: Death")
          ),
          spell.cast("Fade", () =>
            this.hasIncomingCCForFade() && !spell.isOnCooldown("Fade")
          ),

          // Preemptive Fade for predicted enemy CC (priest within 8y, rogue within 4y)
          spell.cast("Fade", () =>
            Settings.UsePreemptiveFade && !spell.isOnCooldown("Fade") && this.shouldPreemptiveFade()
          ),

          common.waitForCastOrChannel(),

          spell.cast("Psychic Scream", on => this.psychicScreamTarget(), ret => this.psychicScreamTarget() !== undefined),

          // Healing rotation (doesn't need enemy target/facing)
          this.healRotation(),
          this.applyAtonement(),

          // Spells that require target and/or facing
          common.waitForTarget(),
          common.waitForFacing(),
          this.targetedDamageRotation()
        )
      )
    );
  }

  waitForNotJustCastPenitence() {
    return new bt.Action(() => {
      let lastCastPenitence = spell.getTimeSinceLastCast("Ultimate Penitence");
      if (lastCastPenitence < 400) {
        return bt.Status.Success;
      }
      return bt.Status.Failure;
    });
  }

  shouldStopCastingForCCCounter() {
    // Only check if we're currently casting something
    if (!me.isCastingOrChanneling) {
      return false;
    }

    // Don't interrupt Ultimate Penitence (spell ID: 421453)
    let currentSpellId = me.currentChannel;
    if (currentSpellId === 0) {
      currentSpellId = me.currentCast;
    }
    if (currentSpellId === 421453) { // Ultimate Penitence
      return false;
    }

    // Check if we have Shadow Word: Death or Fade ready
    const swdReady = !spell.isOnCooldown("Shadow Word: Death");
    const fadeReady = !spell.isOnCooldown("Fade");

    if (!swdReady && !fadeReady) {
      return false;
    }

    // Check for incoming CC spells targeting us
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (!enemy.isCastingOrChanneling || !enemy.spellInfo) {
        continue;
      }

      const spellInfo = enemy.spellInfo;
      const target = spellInfo.spellTargetGuid;

      // Check if the spell is targeting us
      if (!target || !target.equals(me.guid)) {
        continue;
      }

      const spellId = spellInfo.spellCastId;
      const castTimeRemaining = spellInfo.castEnd - wow.frameTime;

      // Only react if the cast will finish soon (within 1 second)
      if (castTimeRemaining > 1000) {
        continue;
      }

      // Check if it's a CC spell we should counter
      if (this.isCCSpellWeCanCounter(spellId, swdReady, fadeReady)) {
        console.log(`[Priest] Detected incoming CC ${spellId} from ${enemy.unsafeName}, casting time remaining: ${castTimeRemaining}ms`);
        return true;
      }
    }

    return false;
  }

  isCCSpellWeCanCounter(spellId, swdReady, fadeReady) {
    // Common CC spells that we want to counter with Shadow Word: Death or Fade
    const ccSpells = {
      // Stuns
      853: "Hammer of Justice", // Paladin
      408: "Kidney Shot", // Rogue
      1833: "Cheap Shot", // Rogue
      179057: "Chaos Nova", // Demon Hunter
      118345: "Pulverize", // Warlock Pet
      30283: "Shadowfury", // Warlock
      5211: "Mighty Bash", // Druid

      // Fears
      5782: "Fear", // Warlock
      6789: "Mortal Coil", // Warlock
      5484: "Howl of Terror", // Warlock
      261589: "Seduction", // Warlock Pet

      // Incapacitates
      51514: "Hex", // Shaman
      210873: "Hex (Compy)", // Shaman
      211004: "Hex (Spider)", // Shaman
      211015: "Hex (Cockroach)", // Shaman
      211010: "Hex (Snake)", // Shaman
      269352: "Hex (Skeletal Hatchling)", // Shaman
      277778: "Hex (Zandalari Tendonripper)", // Shaman
      277784: "Hex (Wicker Mongrel)", // Shaman
      309328: "Hex (Living Honey)", // Shaman
      118: "Polymorph", // Mage
      61305: "Polymorph: Cat", // Mage
      28272: "Polymorph: Pig", // Mage
      61721: "Polymorph: Rabbit", // Mage
      61780: "Polymorph: Turkey", // Mage
      28271: "Polymorph: Turtle", // Mage
      277787: "Polymorph: Direhorn", // Mage
      277792: "Polymorph: Bumblebee", // Mage
      126819: "Polymorph: Porcupine", // Mage
      161353: "Polymorph: Polar Bear", // Mage
      161354: "Polymorph: Monkey", // Mage
      161355: "Polymorph: Penguin", // Mage
      161372: "Polymorph: Peacock", // Mage
      391622: "Polymorph (Duck)", // Mage
      460392: "Polymorph (Mosswool)", // Mage
      217832: "Imprison", // Demon Hunter
      20066: "Repentance", // Paladin
      360806: "Sleep Walk", // Priest

      // Silence/Disarm
      15487: "Silence", // Priest
      1330: "Garrote - Silence", // Rogue
      31935: "Avenger's Shield", // Paladin

      // Roots
      339: "Entangling Roots", // Druid
      102359: "Mass Entanglement", // Druid
      170855: "Binding Shot", // Hunter

      // Other important interrupts
      2139: "Counterspell", // Mage
      47528: "Mind Freeze", // Death Knight
      57994: "Wind Shear", // Shaman
      183752: "Disrupt", // Demon Hunter
      147362: "Counter Shot", // Hunter
      116705: "Spear Hand Strike", // Monk
      96231: "Rebuke", // Paladin
      1766: "Kick", // Rogue
      19647: "Spell Lock", // Warlock Pet
    };

    // If we have Shadow Word: Death ready, we can counter any CC
    if (swdReady && ccSpells[spellId]) {
      return true;
    }

    // If we only have Fade ready, prioritize certain spells
    if (fadeReady && ccSpells[spellId]) {
      // Fade is especially good against fears, incapacitates, and some stuns
      const fadeGoodAgainst = [
        5782, 6789, 5484, 261589, // Fears
        51514, 210873, 211004, 211015, 211010, 269352, 277778, 277784, 309328, // Hex variants
        118, 61305, 28272, 61721, 61780, 28271, 277787, 277792, 126819, 161353, 161354, 161355, 161372, 391622, 460392, // Polymorph variants
        217832, 20066, 360806, // Other incapacitates (Imprison, Repentance, Sleep Walk)
        853, 30283, 5211 // Some stuns
      ];
      return fadeGoodAgainst.includes(spellId);
    }

    return false;
  }

  canCCTarget(unit) {
    // Check if we can CC this target (either not CC'd or CC about to expire)
    if (!unit.isCCd()) {
      return true;
    }

    // If they are CC'd, check common CC auras to see if any are expiring soon (≤1 second)
    const commonCCAuras = [
      // Stuns
      853, 408, 1833, 179057, 118345, 30283, 5211,
      // Fears
      5782, 6789, 5484, 261589,
      // Incapacitates
      51514, 118, 61305, 28272, 61721, 61780, 28271, 277787, 277792, 126819, 161353, 161354, 161355, 161372, 217832,
      // Silences
      15487, 1330, 31935,
      // Roots
      339, 102359, 170855
    ];

    for (const auraId of commonCCAuras) {
      const aura = unit.getAura(auraId);
      if (aura && aura.remaining <= 1000) {
        console.log(`[Priest] Target ${unit.unsafeName} has CC aura ${auraId} expiring in ${aura.remaining}ms - can chain CC`);
        return true;
      }
    }

    return false; // Target is CC'd with more than 1 second remaining
  }

  findIncomingCCTarget() {
    // Find the enemy casting CC on us for Shadow Word: Death counter
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (!enemy.isCastingOrChanneling || !enemy.spellInfo) {
        continue;
      }

      const spellInfo = enemy.spellInfo;
      const target = spellInfo.spellTargetGuid;

      // Check if the spell is targeting us
      if (!target || !target.equals(me.guid)) {
        continue;
      }

      const spellId = spellInfo.spellCastId;
      const castTimeRemaining = spellInfo.castEnd - wow.frameTime;

      // Only counter if the cast will finish very soon (within 1000ms)
      if (castTimeRemaining > 1000) {
        continue;
      }

      // Check if it's a CC spell we can counter with Shadow Word: Death
      if (this.isCCSpellWeCanCounter(spellId, true, false)) {
        console.log(`[Priest] Shadow Word: Death counter target: ${enemy.unsafeName} casting ${spellId}`);
        return enemy;
      }
    }

    return undefined;
  }

  hasIncomingCCForFade() {
    // Check if there's incoming CC that Fade can counter
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (!enemy.isCastingOrChanneling || !enemy.spellInfo) {
        continue;
      }

      const spellInfo = enemy.spellInfo;
      const target = spellInfo.spellTargetGuid;

      // Check if the spell is targeting us
      if (!target || !target.equals(me.guid)) {
        continue;
      }

      const spellId = spellInfo.spellCastId;
      const castTimeRemaining = spellInfo.castEnd - wow.frameTime;

      // Only counter if the cast will finish soon (within 1.5 seconds)
      if (castTimeRemaining > 1500) {
        continue;
      }

      // Check if it's a CC spell we can counter with Fade
      if (this.isCCSpellWeCanCounter(spellId, false, true)) {
        console.log(`[Priest] Fade counter for incoming CC: ${spellId} from ${enemy.unsafeName}`);
        return true;
      }
    }

    return false;
  }

  trackEnemyCC() {
    // Track enemy CC usage from combat log for predictive Fade
    try {
      // Use a simpler approach - check what enemies are doing and update tracking when we see them cast
      const enemies = me.getEnemies();
      const currentTime = wow.frameTime;

      for (const enemy of enemies) {
        if (!enemy.isPlayer() || !enemy.isCastingOrChanneling) continue;

        const spellInfo = enemy.spellInfo;
        if (!spellInfo) continue;

        const spellId = spellInfo.spellCastId;
        const guidKey = enemy.guid.toString();

        // Track specific CC spells we want to predict when we see them being cast
        const trackedSpells = {
          // Priest
          8122: 30000,    // Psychic Scream (30s cooldown)
          // Rogue
          1833: 30000,    // Cheap Shot (30s cooldown)
          408: 20000,     // Kidney Shot (20s cooldown)
          // Other high-impact CC
          51514: 30000,   // Hex (30s cooldown)
          118: 30000,     // Polymorph (30s cooldown)
          853: 60000,     // Hammer of Justice (60s cooldown)
        };

        if (trackedSpells[spellId]) {
          if (!this.enemyCCTracker.has(guidKey)) {
            this.enemyCCTracker.set(guidKey, {});
          }

          // Only update if we haven't recorded this cast yet (to avoid spam)
          const lastRecorded = this.enemyCCTracker.get(guidKey)[spellId];
          if (!lastRecorded || currentTime - lastRecorded > 5000) { // 5 second grace period
            this.enemyCCTracker.get(guidKey)[spellId] = currentTime;
            console.log(`[Priest] Tracked enemy ${enemy.unsafeName} using spell ${spellId} - cooldown: ${trackedSpells[spellId] / 1000}s`);
          }
        }
      }
    } catch (e) {
      // Silently handle errors to avoid spam
    }
  }

  cleanupEnemyTracking() {
    // Remove tracking entries for enemies that are no longer relevant
    const currentTime = wow.frameTime;
    const maxAge = 120000; // Keep tracking for 2 minutes max

    for (const [guidKey, spellData] of this.enemyCCTracker.entries()) {
      let shouldRemove = true;

      // Check if any spells are still relevant (within reasonable timeframe)
      for (const [spellId, timestamp] of Object.entries(spellData)) {
        if (currentTime - timestamp < maxAge) {
          shouldRemove = false;
          break;
        }
      }

      if (shouldRemove) {
        this.enemyCCTracker.delete(guidKey);
      }
    }
  }

  shouldPreemptiveFade() {
    // Check if we should use Fade to avoid predicted enemy CC
    if (spell.isOnCooldown("Fade")) {
      return false;
    }

    this.trackEnemyCC(); // Update our tracking
    this.cleanupEnemyTracking(); // Clean up old entries

    // Check nearby enemies for preemptive fade opportunities
    const currentTime = wow.frameTime;

    // Check for Priest Psychic Scream prediction (8 yard range)
    const nearbyPriests = me.getPlayerEnemies(8);
    for (const enemy of nearbyPriests) {
      if (!enemy.canAttack(me)) continue;

      const guidKey = enemy.guid.toString();
      const enemyTracking = this.enemyCCTracker.get(guidKey);

      if (enemy.klass === KlassType.Priest) {
        const lastPsychicScream = enemyTracking ? enemyTracking[8122] : null;
        const timeSinceLastUse = lastPsychicScream ? currentTime - lastPsychicScream : 999999;

        if (timeSinceLastUse > 29000) { // 29+ seconds since last use (30s cooldown)
          console.log(`[Priest] Preemptive Fade - Enemy priest ${enemy.unsafeName} within 8y, Psychic Scream ready (${Math.floor(timeSinceLastUse / 1000)}s ago)`);
          return true;
        }
      }
    }

    // Check for Rogue CC prediction (4 yard range)
    const nearbyRogues = me.getPlayerEnemies(4);
    for (const enemy of nearbyRogues) {
      if (!enemy.canAttack(me)) continue;

      const guidKey = enemy.guid.toString();
      const enemyTracking = this.enemyCCTracker.get(guidKey);

      if (enemy.klass === KlassType.Rogue) {
        const lastCheapShot = enemyTracking ? enemyTracking[1833] : null;
        const lastKidneyShot = enemyTracking ? enemyTracking[408] : null;

        const timeSinceCheapShot = lastCheapShot ? currentTime - lastCheapShot : 999999;
        const timeSinceKidneyShot = lastKidneyShot ? currentTime - lastKidneyShot : 999999;

        if (timeSinceCheapShot > 29000 || timeSinceKidneyShot > 19000) { // Cheap Shot 30s, Kidney Shot 20s
          const readyAbility = timeSinceCheapShot > 29000 ? "Cheap Shot" : "Kidney Shot";
          console.log(`[Priest] Preemptive Fade - Enemy rogue ${enemy.unsafeName} within 4y, ${readyAbility} ready`);
          return true;
        }
      }
    }

    // Check for Hunter trap prediction (4 yard range)
    const nearbyHunters = me.getPlayerEnemies(4);
    for (const enemy of nearbyHunters) {
      if (!enemy.canAttack(me)) continue;

      const guidKey = enemy.guid.toString();
      const enemyTracking = this.enemyCCTracker.get(guidKey);

      if (enemy.klass === KlassType.Hunter) {
        const lastTrap = enemyTracking ? enemyTracking[187650] : null;
        const lastTrap2 = enemyTracking ? enemyTracking[3355] : null;
        const lastTrap3 = enemyTracking ? enemyTracking[203337] : null;

        const timeSinceTrap = lastTrap ? currentTime - lastTrap : 999999;
        const timeSinceTrap2 = lastTrap2 ? currentTime - lastTrap2 : 999999;
        const timeSinceTrap3 = lastTrap3 ? currentTime - lastTrap3 : 999999;

        if (timeSinceTrap > 29000 || timeSinceTrap2 > 29000 || timeSinceTrap3 > 29000) { // Trap 30s
          console.log(`[Priest] Preemptive Fade - Enemy hunter ${enemy.unsafeName} within 4y, Trap ready`);
          return true;
        }
      }
    }

    // Check for Hunter pet prediction (40 yard range for hunters, 8 yard range for pets)
    const huntersInRange = me.getPlayerEnemies(40);
    for (const enemy of huntersInRange) {
      if (!enemy.canAttack(me)) continue;

      const guidKey = enemy.guid.toString();
      const enemyTracking = this.enemyCCTracker.get(guidKey);

      if (enemy.klass === KlassType.Hunter) {
        for (const unit of me.getUnitsAround(8)) {
          if (unit.summonedBy?.equals(enemy.guid) || unit.createdBy?.equals(enemy.guid)) {
            const lastIntimidation = enemyTracking ? enemyTracking[24394] : null;
            const timeSinceIntimidation = lastIntimidation ? currentTime - lastIntimidation : 999999;

            if (timeSinceIntimidation > 29000) { // Intimidation 30s
              console.log(`[Priest] Preemptive Fade - Enemy hunter ${enemy.unsafeName} has pet within 8y, Intimidation ready`);
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  applyAtonement() {
    return new bt.Selector(
      spell.cast("Power Word: Shield", on => this.findFriendWithoutAtonement(), ret => this.findFriendWithoutAtonement() !== undefined),
      spell.cast("Renew", on => this.findFriendWithoutAtonement(), ret => this.findFriendWithoutAtonement() !== undefined)
    );
  }

  healRotation() {
    return new bt.Selector(
      new bt.Action(() => {
        this.healTarget = h.getPriorityPVPHealTarget();
        return bt.Status.Failure; // Proceed to next child
      }),
      spell.cast("Power Word: Life", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 50),
      spell.cast("Desperate Prayer", on => me, ret => me.effectiveHealthPercent < 40),
      spell.cast("Pain Suppression", on => this.healTarget, ret => this.shouldUsePainSuppression(this.healTarget), {
        callback: () => {
          this.updateDefensiveCooldownTime("Pain Suppression");
          toastSuccess(`Pain Suppression on ${this.healTarget?.unsafeName || 'target'}`, 1.2, 3000);
        }
      }),
      spell.cast("Void Shift", on => this.healTarget, ret => this.shouldUseVoidShift(this.healTarget), {
        callback: () => {
          this.updateDefensiveCooldownTime("Void Shift");
          toastSuccess(`Void Shift with ${this.healTarget?.unsafeName || 'target'}`, 1.2, 3000);
        }
      }),
      spell.cast("Mass Dispel", on => this.findMassDispelTarget(), ret => this.findMassDispelTarget() !== undefined),
      spell.cast("Premonition", on => me, ret => this.shouldCastPremonition(this.healTarget)),
      spell.cast("Evangelism", on => me, ret => me.inCombat() && (
        (this.getAtonementCount() > 3 && this.minAtonementDuration() < 4000)
        || (this.healTarget && this.healTarget.hasAura(auras.atonement) && this.healTarget.effectiveHealthPercent < 40))
      ),
      this.noFacingSpellsImportant(),
      spell.cast("Power Word: Barrier", on => this.healTarget, ret => this.shouldUseBarrier(this.healTarget), {
        callback: () => {
          this.updateDefensiveCooldownTime("Power Word: Barrier");
          toastSuccess(`Power Word: Barrier placed`, 1.2, 3000);
        }
      }),
      spell.cast("Power Word: Shield", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 89 && !this.hasShield(this.healTarget)),
      spell.cast("Power Word: Radiance", on => this.healTarget, ret => this.shouldCastRadiance(this.healTarget, 2)),
      spell.cast("Flash Heal", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 85 && me.hasAura(auras.surgeOfLight)),
      spell.dispel("Purify", true, DispelPriority.High, true, WoWDispelType.Magic),
      spell.dispel("Dispel Magic", false, DispelPriority.High, true, WoWDispelType.Magic),
      spell.cast("Penance", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 69),
      spell.cast("Power Word: Radiance", on => this.healTarget, ret => this.shouldCastRadiance(this.healTarget, 1)),
      spell.cast("Penance", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 79),
      spell.cast("Flash Heal", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 55),
      spell.dispel("Purify", true, DispelPriority.Medium, true, WoWDispelType.Magic),
      spell.dispel("Dispel Magic", false, DispelPriority.Medium, true, WoWDispelType.Magic),
      this.noFacingSpells()
    );
  }

  noFacingSpellsImportant() {
    return new bt.Selector(
      spell.cast("Shadow Word: Death", on => this.findAdvancedShadowWordDeathTarget(), ret =>
        Settings.UseAdvancedShadowWordDeath === true && this.findAdvancedShadowWordDeathTarget() !== undefined
      ),
      spell.cast("Fade", () => Settings.UseFadeForReflectSpells === true && this.shouldUseFadeForReflectSpells()),
      spell.cast("Power Infusion", on => this.findPowerInfusionTarget(), ret =>
        Settings.UseAutoPowerInfusion === true && this.findPowerInfusionTarget() !== undefined
      ),
      spell.cast("Void Tendrils", () => Settings.UseVoidTendrils === true && this.shouldUseVoidTendrils())
    );
  }

  noFacingSpells() {
    return new bt.Selector(
      spell.cast("Mind Control", on => this.findMindControlTarget(), ret =>
        Settings.UseSmartMindControl === true && this.findMindControlTarget() !== undefined
      ),
      spell.cast("Mind Control", on => this.findMindControlDPSTarget(), ret =>
        Settings.UseMindControlDPS === true && this.findMindControlDPSTarget() !== undefined
      ),
      spell.cast("Shadowfiend", on => me.targetUnit, ret =>
        me.targetUnit && me.pctPowerByType(PowerType.Mana) < 90
      ),
      spell.cast("Shadow Word: Pain", on => this.findShadowWordPainTarget(), ret => this.findShadowWordPainTarget() !== undefined)
    );
  }

  targetedDamageRotation() {
    return new bt.Selector(
      // Spells that require target and/or facing
      spell.cast("Mindgames", on => me.targetUnit, ret => me.targetUnit?.effectiveHealthPercent < 50),
      spell.cast("Penance", on => me.targetUnit, ret => me.hasAura(auras.powerOfTheDarkSide)),
      spell.cast("Shadowfiend", on => me.targetUnit, ret => me.pctPowerByType(PowerType.Mana) < 90),
      spell.cast("Mind Blast", on => me.targetUnit, ret => true),
      spell.cast("Smite", on => me.targetUnit, ret => me.pctPower > 30),
    );
  }

  findFriendWithoutAtonement() {
    const friends = me.getPlayerFriends(40);
    for (const friend of friends) {
      if (this.isNotDeadAndInLineOfSight(friend) && !this.hasAtonement(friend)) {
        return friend;
      }
    }
    return undefined;
  }

  findMassDispelTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.hasAura("Ice Block") || enemy.hasAura("Divine Shield")) {
        return enemy;
      }
    }
    return undefined;
  }

  shouldCastPremonition(target) {
    if (!target) {
      return false;
    }
    if (me.hasAura(auras.premonitionInsight) || me.hasAura(auras.premonitionSolace) || me.hasAura(auras.premonitionPiety)) {
      return false;
    }
    return target.effectiveHealthPercent < 50 || target.timeToDeath() < 3;
  }

  hasAtonement(target) {
    return target?.hasAuraByMe(auras.atonement) || false;
  }

  hasShield(target) {
    return target?.hasAuraByMe(auras.powerWordShield) || false;
  }

  hasShadowWordPain(target) {
    return target?.hasAura(auras.shadowWordPain) || false;
  }



  shouldCastRadiance(target, charges) {
    if (!target) {
      return false;
    }
    return target.effectiveHealthPercent < 75 && spell.getCharges("Power Word: Radiance") === charges;
  }

  // Defensive Cooldown Coordination Methods
  canUseDefensiveCooldown() {
    if (!Settings.UseSmartDefensiveCoordination) {
      return true; // If coordination is disabled, allow all defensives
    }

    const currentTime = wow.frameTime;
    const timeSinceLastDefensive = currentTime - this.lastDefensiveCooldownTime;
    const minInterval = Settings.DefensiveCooldownInterval * 1000; // Convert to milliseconds

    return timeSinceLastDefensive >= minInterval;
  }

  updateDefensiveCooldownTime(spellName) {
    const currentTime = wow.frameTime;
    this.lastDefensiveCooldownTime = currentTime;

    // Track individual spell times for additional logic if needed
    switch (spellName) {
      case "Pain Suppression":
        this.lastPainSuppressionTime = currentTime;
        break;
      case "Void Shift":
        this.lastVoidShiftTime = currentTime;
        break;
      case "Power Word: Barrier":
        this.lastBarrierTime = currentTime;
        break;
    }

    console.log(`[Priest] Used defensive cooldown: ${spellName} - Next defensive available in ${Settings.DefensiveCooldownInterval}s`);
  }

  shouldUsePainSuppression(target) {
    if (!target) return false;

    // Check basic conditions first
    if (target.hasAura("Ice Block") || target.hasAura("Divine Shield")) {
      return false;
    }

    // Check if already has Pain Suppression
    if (target.hasAuraByMe(auras.painSuppression)) {
      return false;
    }

    // Check if spell is on cooldown
    if (spell.isOnCooldown("Pain Suppression")) {
      return false;
    }

    // Check health threshold
    const healthThreshold = target.effectiveHealthPercent < Settings.PainSuppressionHealth || target.timeToDeath() < 3;
    if (!healthThreshold) {
      return false;
    }

    // Check defensive coordination
    if (!this.canUseDefensiveCooldown()) {
      return false;
    }

    return true;
  }

  shouldUseVoidShift(target) {
    if (!target) return false;

    // Check basic conditions
    if (target.hasAura("Ice Block") || target.hasAura("Divine Shield")) {
      return false;
    }

    // Check if spell is on cooldown
    if (spell.isOnCooldown("Void Shift")) {
      return false;
    }

    // Void Shift is more situational - only use if target is very low
    const isVeryLow = target.effectiveHealthPercent < Settings.VoidShiftHealth || target.timeToDeath() < 2;
    if (!isVeryLow) {
      return false;
    }

    // Don't void shift if we're also very low (it swaps health)
    if (me.effectiveHealthPercent < 35) {
      return false;
    }

    // Check defensive coordination
    if (!this.canUseDefensiveCooldown()) {
      return false;
    }

    return true;
  }

  shouldUseBarrier(target) {
    if (!target) return false;

    // Check basic conditions
    if (target.hasAura("Ice Block") || target.hasAura("Divine Shield")) {
      return false;
    }

    // Check if spell is on cooldown
    if (spell.isOnCooldown("Power Word: Barrier")) {
      return false;
    }

    // Check health threshold
    const healthThreshold = target.effectiveHealthPercent < Settings.BarrierHealth || target.timeToDeath() < 3;
    if (!healthThreshold) {
      return false;
    }

    // Barrier is area-based, so prefer it when multiple people need help
    const friendsNearTarget = me.getPlayerFriends(40).filter(friend =>
      friend.distanceTo(target) <= 10 &&
      friend.effectiveHealthPercent < 70
    ).length;

    // If multiple people near target need help, prioritize barrier
    if (friendsNearTarget >= 2) {
      // Check defensive coordination
      if (!this.canUseDefensiveCooldown()) {
        return false;
      }
      return true;
    }

    // For single target, only use if no other defensives are better options
    if (target.effectiveHealthPercent < Settings.BarrierHealth) {
      // Check if Pain Suppression would be better (single target damage reduction)
      // Fixed logic: if target is above Pain Suppression threshold OR Pain Suppression is on cooldown, use Barrier
      if (target.effectiveHealthPercent < Settings.PainSuppressionHealth &&
        !spell.isOnCooldown("Pain Suppression")) {
        return false; // Let Pain Suppression handle it (target is low enough for PS and PS is available)
      }

      // Check defensive coordination
      if (!this.canUseDefensiveCooldown()) {
        return false;
      }
      return true;
    }

    return false;
  }



  isNotDeadAndInLineOfSight(friend) {
    return friend && !friend.deadOrGhost && me.withinLineOfSight(friend);
  }

  getAtonementCount() {
    return h.friends.All.filter(friend => this.hasAtonement(friend)).length;
  }

  minAtonementDuration() {
    let minDuration = Infinity;
    for (const friend of h.friends.All) {
      if (this.hasAtonement(friend)) {
        const duration = friend.getAuraByMe(auras.atonement).remaining;
        if (duration < minDuration) {
          minDuration = duration;
        }
      }
    }
    return minDuration === Infinity ? 0 : minDuration;
  }

  findShadowWordPainTarget() {
    // Only search for targets when in combat
    if (!me.inCombat()) {
      return undefined;
    }

    // Shadow Word: Pain doesn't require facing but needs LOS
    // Prioritize current target if it doesn't have SW:P and isn't immune
    if (me.targetUnit &&
      me.targetUnit.isPlayer() &&
      !this.hasShadowWordPain(me.targetUnit) &&
      !pvpHelpers.hasImmunity(me.targetUnit) &&
      me.distanceTo(me.targetUnit) <= 40 &&
      me.withinLineOfSight(me.targetUnit)) {
      return me.targetUnit;
    }

    // Find any enemy without Shadow Word: Pain
    const enemies = me.getPlayerEnemies(40);
    for (const enemy of enemies) {
      if (me.withinLineOfSight(enemy) &&
        !this.hasShadowWordPain(enemy) &&
        !pvpHelpers.hasImmunity(enemy)) {
        return enemy;
      }
    }

    return undefined;
  }

  psychicScreamTarget() {
    // Psychic Scream (Fear) doesn't require facing but needs LOS
    const enemies = me.getPlayerEnemies(8);

    for (const unit of enemies) {
      if (unit.isHealer() &&
        me.withinLineOfSight(unit) &&
        this.canCCTarget(unit) &&
        unit.canCC() &&
        !pvpHelpers.hasImmunity(unit) &&
        drTracker.getDRStacks(unit.guid, "disorient") === 0) {
        return unit;
      }
    }

    return undefined;
  }

  // Enhanced PVP Methods

  findPowerInfusionTarget() {
    // Check cooldown first
    if (spell.isOnCooldown("Power Infusion")) {
      return undefined;
    }

    const friends = me.getPlayerFriends(40);
    let bestTarget = null;
    let bestPriority = 0;

    for (const friend of friends) {
      if (!me.withinLineOfSight(friend) ||
        friend.hasAura(auras.powerInfusion)) { // Don't double-buff
        continue;
      }

      const majorCooldown = pvpHelpers.hasMajorDamageCooldown(friend, 5);
      if (!majorCooldown) {
        continue;
      }

      // Calculate priority based on class role and cooldown duration
      let priority = 0;

      // Higher priority for DPS classes (configurable)
      if (Settings.PowerInfusionPrioritizeDPS === true) {
        if (!friend.isHealer()) { // Consider non-healers as damage classes
          priority += 100;
        } else if (friend.isHealer()) {
          priority += 50; // Support healers too, but lower priority
        }
      } else {
        // Equal priority for all classes
        priority += 75; // All player classes get equal priority
      }

      // Bonus for longer duration cooldowns
      if (majorCooldown.remainingTime > 8) {
        priority += 50;
      } else if (majorCooldown.remainingTime > 5) {
        priority += 25;
      }

      // Bonus for low health (help them survive burst)
      if (friend.effectiveHealthPercent < 60) {
        priority += 30;
      }

      // Check if they have multiple major cooldowns (even better target)
      const allMajorCDs = this.countMajorCooldowns(friend);
      if (allMajorCDs > 1) {
        priority += 25 * (allMajorCDs - 1);
      }

      if (priority > bestPriority) {
        bestPriority = priority;
        bestTarget = friend;
      }
    }

    if (bestTarget) {
      const majorCooldown = pvpHelpers.hasMajorDamageCooldown(bestTarget, 3);
      console.log(`[Priest] Power Infusion on ${bestTarget.unsafeName} with ${majorCooldown.name} (${majorCooldown.remainingTime.toFixed(1)}s remaining)`);
    }

    return bestTarget;
  }

  countMajorCooldowns(unit) {
    let count = 0;
    // This is a simplified count - you could enhance this to check for specific buff combinations
    if (pvpHelpers.hasMajorDamageCooldown(unit, Settings.PowerInfusionMinDuration)) {
      count++;
      // You could add more specific checks here for different types of cooldowns
    }
    return count;
  }

  shouldUseFadeForReflectSpells() {
    // Check if Shadow Word: Death is available
    if (spell.isOnCooldown("Fade")) {
      return false;
    }
    const swdCooldown = spell.getCooldown("Shadow Word: Death");
    const swdReady = swdCooldown && swdCooldown.ready;

    // Check all enemies for incoming spells
    const enemies = me.getPlayerEnemies(40);
    for (const enemy of enemies) {
      if (enemy.isCastingOrChanneling &&
        me.withinLineOfSight(enemy)) {
        const spellInfo = enemy.spellInfo;
        const target = spellInfo ? spellInfo.spellTargetGuid : null;
        if (enemy.spellInfo && target && target.equals(me.guid)) {
          const spellId = enemy.spellInfo.spellCastId;

          // Check if spell should be reflected using pvpReflect data
          if (pvpHelpers.shouldReflectSpell && pvpHelpers.shouldReflectSpell(spellId)) {
            const castRemains = enemy.spellInfo.castEnd - wow.frameTime;

            // Use Fade if less than 1s left on cast
            if (castRemains < 1000) {
              // If Shadow Word: Death is ready, only use Fade on reflect spells that are NOT blacklisted
              // (let SW:D handle the blacklist spells instead of wasting Fade)
              if (swdReady) {
                const isBlacklistedSpell = spellBlacklist[spellId];
                if (isBlacklistedSpell) {
                  console.log(`[Priest] Not using Fade for ${spellId} from ${enemy.unsafeName} - SW:D ready for blacklist spell`);
                  continue; // Skip this spell, let SW:D handle it
                }
              }

              console.log(`[Priest] Using Fade for reflect spell ${spellId} from ${enemy.unsafeName} (SW:D ready: ${swdReady})`);
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  shouldUseVoidTendrils() {
    // Check cooldown first
    if (spell.isOnCooldown("Void Tendrils")) {
      return false;
    }

    // Void Tendrils doesn't require facing but needs LOS
    const enemies = me.getPlayerEnemies(8);
    const eligibleEnemies = enemies.filter(enemy =>
      me.withinLineOfSight(enemy) &&
      !pvpHelpers.hasImmunity(enemy)
    );

    if (eligibleEnemies.length >= 2) {
      console.log(`[Priest] Using Void Tendrils - ${eligibleEnemies.length} enemies within 8 yards`);
      return true;
    }
    return false;
  }

  findMindControlTarget() {
    // Check cooldown first
    if (spell.isOnCooldown("Mind Control")) {
      return undefined;
    }

    // Check if a friend has major CDs up
    const friendsWithCDs = this.getFriendsWithMajorCDs();
    if (friendsWithCDs.length === 0) {
      return undefined;
    }

    // Check if enemy team does not have major CDs
    const enemiesWithCDs = this.getEnemiesWithMajorCDs();
    if (enemiesWithCDs.length > 0) {
      return undefined;
    }

    // Check if all friendly players are above health threshold
    if (!this.allFriendsAboveHealthThreshold()) {
      return undefined;
    }

    // Mind Control doesn't require facing but needs LOS
    const enemies = me.getPlayerEnemies(30);
    for (const enemy of enemies) {
      if (enemy.isHealer() &&
        me.withinLineOfSight(enemy) &&
        this.canCCTarget(enemy) &&
        enemy.canCC() &&
        drTracker.getDRStacks(enemy.guid, "disorient") <= Settings.MindControlMaxDR &&
        !pvpHelpers.hasImmunity(enemy)) {

        console.log(`[Priest] Mind Control conditions met - targeting ${enemy.unsafeName}`);
        return enemy;
      }
    }
    return null;
  }

  findMindControlDPSTarget() {
    // Check if the setting is enabled first
    if (Settings.UseMindControlDPS !== true) {
      return undefined;
    }

    // Check cooldown first
    if (spell.isOnCooldown("Mind Control")) {
      return undefined;
    }

    // Check if all friendly players are above DPS threshold
    if (!this.allFriendsAboveDPSThreshold()) {
      return undefined;
    }

    // Mind Control enemy DPS with major cooldowns - doesn't require facing but needs LOS
    const enemies = me.getPlayerEnemies(30);
    for (const enemy of enemies) {
      if (!enemy.isHealer() && // Target non-healers (DPS/Tanks)
        me.withinLineOfSight(enemy) &&
        this.canCCTarget(enemy) &&
        enemy.canCC() &&
        drTracker.getDRStacks(enemy.guid, "disorient") <= Settings.MindControlMaxDR &&
        !pvpHelpers.hasImmunity(enemy)) {

        // Check if this enemy has major cooldowns active
        const majorCooldown = pvpHelpers.hasMajorDamageCooldown(enemy, 3);
        if (majorCooldown) {
          console.log(`[Priest] Mind Control DPS conditions met - targeting ${enemy.unsafeName} with major CD`);
          return enemy;
        }
      }
    }
    return null;
  }

  findAdvancedShadowWordDeathTarget() {
    // Check cooldown first
    if (spell.isOnCooldown("Shadow Word: Death")) {
      return undefined;
    }

    // Shadow Word: Death doesn't require facing but needs LOS
    // First priority: Anyone casting spellBlacklist spells on us
    const enemiesForInterrupt = me.getPlayerEnemies(46);
    for (const enemy of enemiesForInterrupt) {
      if (enemy.isCastingOrChanneling &&
        me.withinLineOfSight(enemy) &&
        !pvpHelpers.hasImmunity(enemy)) {
        const spellInfo = enemy.spellInfo;
        const target = spellInfo ? spellInfo.spellTargetGuid : null;
        if (enemy.spellInfo && target && target.equals(me.guid)) {
          const onBlacklist = spellBlacklist[enemy.spellInfo.spellCastId];
          const castRemains = enemy.spellInfo.castEnd - wow.frameTime;
          if (onBlacklist && castRemains < 1000) {
            console.log(`[Priest] Shadow Word: Death interrupt on ${enemy.unsafeName} casting ${enemy.spellInfo.spellCastId}`);
            return enemy;
          }
        }
      }
    }

    // Second priority: Low health enemies (execute)
    const enemiesForExecute = me.getPlayerEnemies(40);
    for (const enemy of enemiesForExecute) {
      if (enemy.effectiveHealthPercent < 20 &&
        me.withinLineOfSight(enemy) &&
        !pvpHelpers.hasImmunity(enemy)) {
        return enemy;
      }
    }

    return null;
  }

  getFriendsWithMajorCDs() {
    // Major cooldowns detection with LOS check
    const friends = me.getPlayerFriends(40);
    const friendsWithCDs = [];

    for (const friend of friends) {
      if (me.withinLineOfSight(friend)) {
        const majorCooldown = pvpHelpers.hasMajorDamageCooldown(friend, 3);
        if (majorCooldown) {
          friendsWithCDs.push(friend);
        }
      }
    }
    return friendsWithCDs;
  }

  getEnemiesWithMajorCDs() {
    // Major cooldowns detection with LOS check
    const enemies = me.getPlayerEnemies(40);
    const enemiesWithCDs = [];

    for (const enemy of enemies) {
      if (me.withinLineOfSight(enemy)) {
        const majorCooldown = pvpHelpers.hasMajorDamageCooldown(enemy, 3);
        if (majorCooldown) {
          enemiesWithCDs.push(enemy);
        }
      }
    }
    return enemiesWithCDs;
  }

  allFriendsAboveHealthThreshold() {
    // Health checking with LOS requirement
    const friends = me.getPlayerFriends(40);
    for (const friend of friends) {
      if (me.withinLineOfSight(friend) &&
        friend.effectiveHealthPercent < Settings.MindControlHealthThreshold) {
        return false;
      }
    }
    return true;
  }

  allFriendsAboveDPSThreshold() {
    // Health checking for DPS Mind Control with LOS requirement
    const friends = me.getPlayerFriends(40);
    for (const friend of friends) {
      if (me.withinLineOfSight(friend) &&
        friend.effectiveHealthPercent < Settings.MindControlDPSHealthThreshold) {
        return false;
      }
    }
    return true;
  }
}

