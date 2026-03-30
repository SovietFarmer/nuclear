import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import Settings from "@/Core/Settings";
import { spellBlacklist } from "@/Data/PVPData";

const auras = {
  earthShield: 974,
  earthShieldSelf: 383648,
  earthlivingWeapon: 382022,
  waterShield: 52127,
  riptide: 61295,
  tidalWaves: 51564,
  naturesSwiftness: 378081,
  ancestralSwiftness: 443454,
  unleashLife: 73685,
  flameShock: 188389,
  lavaSurge: 77762,
  spiritLinkTotem: 98008,
  healingTideTotem: 108280,
  stormstreamTotem: 1267089,
  astralShift: 108271,
  spiritWalkersGrace: 79206,
};

export class ShamanRestorationPvP extends Behavior {
  name = "Restoration Shaman PvP (Midnight Farseer)";
  context = BehaviorContext.Any;
  specialization = Specialization.Shaman.Restoration;
  version = wow.GameVersion.Retail;

  healTarget = null;

  static settings = [
    {
      header: "Resto Shaman PvP (Midnight Farseer)",
      options: [
        { type: "slider", uid: "RShamPvPAstralShiftPct", text: "Astral Shift HP %", default: 40, min: 0, max: 100 },
        { type: "slider", uid: "RShamPvPBurrowPct", text: "Burrow HP % (emergency)", default: 20, min: 0, max: 100 },
        { type: "slider", uid: "RShamPvPNaturesSwiftnessPct", text: "Nature's Swiftness HP % (emergency heal)", default: 50, min: 0, max: 100 },
        { type: "slider", uid: "RShamPvPSpiritLinkPct", text: "Spirit Link Totem HP %", default: 33, min: 0, max: 100 },
        { type: "slider", uid: "RShamPvPHealingTidePct", text: "Healing Tide Totem HP %", default: 42, min: 0, max: 100 },
        { type: "slider", uid: "RShamPvPUnleashLifePct", text: "Unleash Life HP %", default: 70, min: 0, max: 100 },
        { type: "slider", uid: "RShamPvPRiptidePct", text: "Riptide HP %", default: 85, min: 0, max: 100 },
        { type: "slider", uid: "RShamPvPHealingWavePct", text: "Healing Wave HP %", default: 80, min: 0, max: 100 },
        { type: "checkbox", uid: "RShamPvPUsePurge", text: "Use Greater Purge", default: false },
        { type: "checkbox", uid: "RShamPvPUseLightningLasso", text: "Use Lightning Lasso", default: false },
        { type: "checkbox", uid: "RShamPvPUseCapacitorTotem", text: "Use Capacitor Totem", default: true },
        { type: "checkbox", uid: "RShamPvPUseSpiritwalkersGrace", text: "Auto Spiritwalker's Grace", default: false },
      ],
    },
  ];

  build() {
    return new bt.Selector(
      // --- Prerequisites ---
      common.waitForNotMounted(),
      common.waitForNotSitting(),

      // --- Off-GCD (BEFORE GCD gate) ---
      new bt.Decorator(
        () => !this.shouldProtectLassoChannel(),
        spell.interrupt("Wind Shear", true)
      ),
      spell.cast("Grounding Totem", on => me, ret =>
        !this.shouldProtectLassoChannel() && this.shouldDropGroundingForCC()
      ),
      spell.cast("Tremor Totem", on => me, ret =>
        !this.shouldProtectLassoChannel() && this.shouldDropTremorForCC()
      ),
      spell.cast("Spiritwalker's Grace", on => me, ret =>
        !this.shouldProtectLassoChannel() &&
        Settings.RShamPvPUseSpiritwalkersGrace &&
        spell.isSpellKnown("Spiritwalker's Grace") &&
        me.isMoving() &&
        !me.hasAura(auras.spiritWalkersGrace) &&
        this.isHealingNeeded() &&
        !me.hasAuraByMe("Ghost Wolf")
      ),

      common.waitForCastOrChannel(),
      new bt.Decorator(
        () => this.shouldStopCasting(),
        new bt.Action(() => {
          me.stopCasting();
          return bt.Status.Success;
        })
      ),

      // --- Buffs (works during arena prep) ---
      this.ensureBuffs(),

      common.waitForNotWaitingForArenaToStart(),

      // --- GCD gate ---
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          // Refresh heal target every tick
          new bt.Action(() => {
            this.healTarget = heal.getPriorityPVPHealTarget();
            return bt.Status.Failure;
          }),

          this.defensiveCooldowns(),
          this.emergencyHealing(),
          this.hexRotation(),
          this.lightningLasso(),
          this.healRotation(),
          this.dispelRotation(),

          common.waitForTarget(),
          common.waitForFacing(),
          common.waitForCombat(),
          this.damageRotation()
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Buffs
  // ---------------------------------------------------------------------------

  ensureBuffs() {
    return new bt.Selector(
      spell.cast("Skyfury", on => me, ret => !me.hasVisibleAura("Skyfury") && !me.hasAuraByMe("Ghost Wolf")),
      spell.cast("Water Shield", on => me, ret => !me.hasAura(auras.waterShield) && !me.hasAuraByMe("Ghost Wolf")),
      spell.cast("Earthliving Weapon", on => me, ret => !me.hasAura(auras.earthlivingWeapon) && !me.hasAuraByMe("Ghost Wolf")),
      spell.cast("Earth Shield", on => me, ret => !me.hasAura(auras.earthShieldSelf) && !me.hasAuraByMe("Ghost Wolf")),
    );
  }

  // ---------------------------------------------------------------------------
  // Defensives
  // ---------------------------------------------------------------------------

  defensiveCooldowns() {
    return new bt.Selector(
      spell.cast("Astral Shift", on => me, ret =>
        me.effectiveHealthPercent < Settings.RShamPvPAstralShiftPct && me.inCombat()
      ),
      spell.cast("Burrow", on => me, ret =>
        me.effectiveHealthPercent < Settings.RShamPvPBurrowPct &&
        me.inCombat() &&
        spell.isOnCooldown("Astral Shift")
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Emergency Healing
  // ---------------------------------------------------------------------------

  emergencyHealing() {
    return new bt.Decorator(
      () => this.isEmergencyHealingNeeded(),
      new bt.Selector(
        // Activate Nature's Swiftness for instant heal
        spell.cast("Nature's Swiftness", on => me, ret =>
          this.healTarget?.effectiveHealthPercent < Settings.RShamPvPNaturesSwiftnessPct &&
          !me.hasAura(auras.ancestralSwiftness)
        ),
        // Instant Healing Wave via NS or Ancestral Swiftness proc
        spell.cast("Healing Wave", on => this.healTarget, ret =>
          me.hasAura(auras.naturesSwiftness) || me.hasAura(auras.ancestralSwiftness)
        ),
        // Spirit Link when someone is about to die
        spell.cast("Spirit Link Totem",
          on => this.getBestSpiritLinkTarget(),
          ret => this.shouldCastSpiritLinkTotem()
        ),
        // Healing Tide Totem for team-wide pressure
        spell.cast("Healing Tide Totem", on => me, ret =>
          this.healTarget?.effectiveHealthPercent < Settings.RShamPvPHealingTidePct
        ),
        // Emergency Riptide if target doesn't have it
        spell.cast("Riptide", on => this.healTarget, ret =>
          !this.healTarget?.hasAuraByMe(auras.riptide)
        ),
        // Hard-cast Healing Wave fallback
        spell.cast("Healing Wave", on => this.healTarget),
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Hex Rotation (offensive CC)
  // ---------------------------------------------------------------------------

  hexRotation() {
    return new bt.Decorator(
      () => this.healTarget && this.healTarget.effectiveHealthPercent > 70,
      new bt.Selector(
        // Use NS for instant Hex (Call of Al'Akir) when available
        spell.cast("Nature's Swiftness", on => me, ret =>
          this.getHexTarget() !== undefined &&
          !me.hasAura(auras.naturesSwiftness) &&
          !me.hasAura(auras.ancestralSwiftness) &&
          spell.getTimeSinceLastCast("Hex") > 2000
        ),
        spell.cast("Hex",
          on => this.getHexTarget(),
          ret => this.getHexTarget() !== undefined && spell.getTimeSinceLastCast("Hex") > 2000
        ),
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Lightning Lasso (offensive control)
  // ---------------------------------------------------------------------------

  lightningLasso() {
    return spell.cast("Lightning Lasso",
      on => this.getLassoTarget(),
      ret => Settings.RShamPvPUseLightningLasso &&
        this.getLassoTarget() !== undefined &&
        this.healTarget?.effectiveHealthPercent > 75
    );
  }

  // ---------------------------------------------------------------------------
  // Sustained Healing
  // ---------------------------------------------------------------------------

  healRotation() {
    return new bt.Selector(
      // Earth Shield on focused teammate
      spell.cast("Earth Shield",
        on => this.getEarthShieldTarget(),
        ret => this.getEarthShieldTarget() !== null
      ),
      // Unleash Life on CD -- Farseer: triggers Ancestor via Call of the Ancestors
      spell.cast("Unleash Life", on => me, ret =>
        this.healTarget?.effectiveHealthPercent < Settings.RShamPvPUnleashLifePct
      ),
      // Riptide spread for Undercurrent / Flow of the Tides
      spell.cast("Riptide",
        on => this.getAllyNeedingRiptide(),
        ret => this.getAllyNeedingRiptide() !== null
      ),
      // Stormstream Totem when proc aura is active (Apex talent)
      spell.cast("Stormstream Totem", on => me, ret =>
        me.hasAura(auras.stormstreamTotem)
      ),
      // Ancestral Swiftness -> instant Healing Wave
      spell.cast("Ancestral Swiftness", on => me, ret =>
        this.healTarget?.effectiveHealthPercent < 80 &&
        spell.getTimeSinceLastCast("Ancestral Swiftness") > 2000
      ),
      spell.cast("Healing Wave", on => this.healTarget, ret =>
        me.hasAura(auras.ancestralSwiftness) &&
        this.healTarget?.effectiveHealthPercent < Settings.RShamPvPHealingWavePct
      ),
      // Healing Stream Totem on cooldown for passive healing
      spell.cast("Healing Stream Totem", on => me, ret =>
        spell.getTimeSinceLastCast("Healing Stream Totem") > 12000 &&
        this.healTarget?.effectiveHealthPercent < 90
      ),
      // Healing Wave with Tidal Waves (safe to hard-cast)
      spell.cast("Healing Wave", on => this.healTarget, ret =>
        me.hasAura(auras.tidalWaves) &&
        this.healTarget?.effectiveHealthPercent < Settings.RShamPvPHealingWavePct
      ),
      // Healing Wave filler
      spell.cast("Healing Wave", on => this.healTarget, ret =>
        this.healTarget?.effectiveHealthPercent < 90
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Dispels
  // ---------------------------------------------------------------------------

  dispelRotation() {
    return new bt.Selector(
      spell.dispel("Purify Spirit", true, DispelPriority.High, true, WoWDispelType.Magic),
      spell.dispel("Purify Spirit", true, DispelPriority.High, true, WoWDispelType.Curse),
      spell.dispel("Greater Purge", false, DispelPriority.High, true, WoWDispelType.Magic, ret => Settings.RShamPvPUsePurge),
      spell.dispel("Purify Spirit", true, DispelPriority.Medium, true, WoWDispelType.Magic),
      spell.dispel("Greater Purge", false, DispelPriority.Medium, true, WoWDispelType.Magic, ret => Settings.RShamPvPUsePurge),
    );
  }

  // ---------------------------------------------------------------------------
  // Damage
  // ---------------------------------------------------------------------------

  damageRotation() {
    return new bt.Selector(
      spell.dispel("Purify Spirit", true, DispelPriority.Low, true, WoWDispelType.Magic),
      spell.dispel("Greater Purge", false, DispelPriority.Low, true, WoWDispelType.Magic, ret => Settings.RShamPvPUsePurge),
      spell.cast("Flame Shock", on => me.targetUnit, ret =>
        me.targetUnit && me.targetUnit.isPlayer() && !me.targetUnit.hasAuraByMe(auras.flameShock)
      ),
      spell.cast("Lava Burst", on => me.targetUnit, ret =>
        me.hasAura(auras.lavaSurge) && me.targetUnit?.hasAuraByMe(auras.flameShock)
      ),
      spell.cast("Chain Lightning", on => me.targetUnit, ret =>
        me.targetUnit?.getUnitsAroundCount(10) > 1
      ),
      spell.cast("Lava Burst", on => me.targetUnit, ret =>
        me.targetUnit?.hasAuraByMe(auras.flameShock)
      ),
      spell.cast("Lightning Bolt", on => me.targetUnit),
    );
  }

  // ---------------------------------------------------------------------------
  // Helper: Stop Casting
  // ---------------------------------------------------------------------------

  shouldStopCasting() {
    if (!me.isCastingOrChanneling) return false;
    const currentCast = me.currentCastOrChannel;
    if (currentCast.timeleft < 300) return false;

    if (currentCast.name === "Lightning Lasso") {
      return this.isTeamBelowHealth(50);
    }

    const isDamageCast = [
      "Flame Shock", "Lava Burst", "Chain Lightning", "Lightning Bolt"
    ].includes(currentCast.name);

    return isDamageCast && this.isEmergencyHealingNeeded();
  }

  shouldProtectLassoChannel() {
    if (!me.isCastingOrChanneling) return false;
    const cast = me.currentCastOrChannel;
    if (!cast || cast.name !== "Lightning Lasso") return false;
    return !this.isTeamBelowHealth(50);
  }

  isTeamBelowHealth(threshold) {
    const allies = heal.priorityList.filter(ally =>
      ally && ally.isPlayer() && me.withinLineOfSight(ally)
    );
    if (!allies.some(ally => ally.guid.equals(me.guid))) {
      allies.push(me);
    }
    return allies.some(ally => ally.effectiveHealthPercent < threshold);
  }

  isHealingNeeded() {
    const target = heal.getPriorityPVPHealTarget();
    return target && target.effectiveHealthPercent < 85;
  }

  isEmergencyHealingNeeded() {
    const target = heal.getPriorityPVPHealTarget();
    if (!target) return false;
    return me.inCombat() &&
      target.inCombat() &&
      me.withinLineOfSight(target) &&
      target.effectiveHealthPercent <= 55;
  }

  // ---------------------------------------------------------------------------
  // Helper: Grounding Totem (counter incoming CC via spellBlacklist)
  // ---------------------------------------------------------------------------

  shouldDropGroundingForCC() {
    const enemies = combat.targets.filter(unit => unit && unit.isPlayer());
    for (const enemy of enemies) {
      if (!enemy.isCastingOrChanneling) continue;
      const info = enemy.spellInfo;
      if (!info) continue;
      const targetGuid = info.spellTargetGuid;
      if (!targetGuid) continue;

      const onBlacklist = spellBlacklist[info.spellCastId];
      if (!onBlacklist) continue;

      const castRemains = info.castEnd - wow.frameTime;
      // Absorb CC targeting us or any party member
      const isTargetingAlly = targetGuid.equals(me.guid) ||
        heal.priorityList.some(ally => ally && targetGuid.equals(ally.guid));
      if (isTargetingAlly && castRemains < 1000) return true;
    }
    return false;
  }

  shouldDropTremorForCC() {
    if (!me.inCombat()) return false;
    if (this.isTotemActive("Tremor Totem")) return false;
    if (spell.getTimeSinceLastCast("Tremor Totem") < 2000) return false;

    // Immediate break for already-applied fear / mind control style effects.
    const allies = heal.priorityList.filter(ally => ally && ally.isPlayer());
    allies.push(me);
    const allyUnderCC = allies.some(ally =>
      ally.isFeared || ally.hasAura("Mind Control") || ally.hasAura("Fear")
    );
    if (allyUnderCC) return true;

    // Predictive drop only for true casted fear/MC spells to avoid random Tremors.
    const tremorReactiveCasts = new Set([
      5782, // Fear
      605, // Mind Control
      383121, // Mass Fear
      64044, // Psychic Horror
    ]);

    const enemies = combat.targets.filter(unit => unit && unit.isPlayer());
    for (const enemy of enemies) {
      try {
        if (!enemy.isCastingOrChanneling || !enemy.spellInfo) continue;
        const info = enemy.spellInfo;
        const targetGuid = info.spellTargetGuid;
        if (!targetGuid) continue;
        if (!tremorReactiveCasts.has(info.spellCastId)) continue;

        const castRemains = info.castEnd - wow.frameTime;
        const isTargetingAlly = targetGuid.equals(me.guid) ||
          heal.priorityList.some(ally => ally && targetGuid.equals(ally.guid));
        if (isTargetingAlly && castRemains > 0 && castRemains <= 1200) {
          return true;
        }
      } catch {
        // Skip stale reads.
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Helper: Earth Shield on focused teammate
  // ---------------------------------------------------------------------------

  getEarthShieldTarget() {
    const target = this.healTarget;
    if (
      target &&
      target !== me &&
      target.isPlayer() &&
      target.effectiveHealthPercent < 80 &&
      !target.hasAura(auras.earthShield) &&
      spell.getTimeSinceLastCast("Earth Shield") >= 3500
    ) {
      return target;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Helper: Riptide spread
  // ---------------------------------------------------------------------------

  getAllyNeedingRiptide() {
    // Riptide at arena gate exit: cast on allies missing your Riptide even when HP is full.
    // heal.priorityList can be empty briefly at match start, so fall back to raw player-friends.
    let list = heal.priorityList;
    if (!list || list.length === 0) {
      list = me.getPlayerFriends(40);
    }

    if (!list.some(u => u && u.guid.equals(me.guid))) {
      list.push(me);
    }

    const candidates = list.filter(a =>
      a &&
      a.isPlayer() &&
      !a.hasAuraByMe(auras.riptide) &&
      me.withinLineOfSight(a) &&
      me.distanceTo(a) <= 40
    );

    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => a.effectiveHealthPercent - b.effectiveHealthPercent)[0];
  }

  // ---------------------------------------------------------------------------
  // Helper: Hex Target
  // ---------------------------------------------------------------------------

  getHexTarget() {
    const nearbyEnemies = me.getPlayerEnemies(30);
    for (const unit of nearbyEnemies) {
      if (
        unit.isHealer() &&
        !unit.isCCd() &&
        unit.canCC() &&
        unit.getDR("incapacitate") === 0 &&
        me.withinLineOfSight(unit)
      ) {
        return unit;
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Helper: Lightning Lasso Target
  // ---------------------------------------------------------------------------

  getLassoTarget() {
    if (!me.inCombat()) return undefined;
    const target = me.targetUnit;
    if (
      target &&
      target.isPlayer() &&
      !target.isCCd() &&
      target.canCC() &&
      target.getDR("stun") === 0 &&
      me.withinLineOfSight(target) &&
      me.isFacing(target)
    ) {
      return target;
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Helper: Spirit Link Totem
  // ---------------------------------------------------------------------------

  shouldCastSpiritLinkTotem() {
    const target = this.getBestSpiritLinkTarget();
    if (!target) return false;
    const alliesNear = this.getAlliesInRange(target, 12);
    const lowHealthAllies = alliesNear.filter(ally =>
      ally.effectiveHealthPercent < Settings.RShamPvPSpiritLinkPct
    );
    return lowHealthAllies.length >= 1;
  }

  getBestSpiritLinkTarget() {
    return heal.priorityList.reduce((best, current) => {
      if (!current || !current.isPlayer()) return best;
      const alliesNear = this.getAlliesInRange(current, 12);
      const lowHealthAllies = alliesNear.filter(ally =>
        ally.effectiveHealthPercent < Settings.RShamPvPSpiritLinkPct
      );
      if (!best) return current;
      const bestLow = this.getAlliesInRange(best, 12).filter(ally =>
        ally.effectiveHealthPercent < Settings.RShamPvPSpiritLinkPct
      );
      return lowHealthAllies.length > bestLow.length ? current : best;
    }, null);
  }

  // ---------------------------------------------------------------------------
  // Helper: Allies in Range
  // ---------------------------------------------------------------------------

  getAlliesInRange(unit, range) {
    const allies = heal.priorityList.filter(ally =>
      ally && ally.isPlayer() && ally.distanceTo(unit) <= range && me.withinLineOfSight(ally)
    );
    if (!allies.some(ally => ally.guid.equals(me.guid)) && me.distanceTo(unit) <= range) {
      allies.push(me);
    }
    return allies;
  }

  isTotemActive(totemName) {
    if (!wow.GameUI.totemInfo) return false;
    for (let i = 1; i <= 6; i++) {
      const info = wow.GameUI.totemInfo[i];
      if (info && info.name === totemName) return true;
    }
    return false;
  }

  noEnemiesWithinRange(range) {
    return !combat.targets.some(unit => unit && unit.isPlayer() && unit.distanceTo(me) <= range);
  }
}
