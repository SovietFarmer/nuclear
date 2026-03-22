import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import objMgr, { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import Settings from "@/Core/Settings";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";

const auras = {
  earthShield: 974,
  earthShieldPlayer: 383648,
  riptide: 61295,
  tidalWaves: 51564,
  ascendance: 114052,
  naturesSwiftness: 378081,
  unleashLife: 73685,
  earthlivingWeapon: 382022,
  waterShield: 52127,
  flameShock: 188389,
  lavaSurge: 77762,
  ancestralSwiftness: 443454,
  stormstreamTotem: 1267089,
};

export class ShamanRestorationBehavior extends Behavior {
  name = "Restoration Shaman";
  context = BehaviorContext.Any;
  specialization = Specialization.Shaman.Restoration;
  version = wow.GameVersion.Retail;

  cachedLowestHealthAlly = null;
  cachedLowestHealthExpiry = 0;

  static settings = [
    {
      header: "Restoration Shaman (Farseer M+)",
      options: [
        { type: "slider", uid: "RestoShamanEmergencyHealingThreshold", text: "Emergency Healing Threshold", min: 0, max: 100, default: 30 },
        { type: "slider", uid: "RestoShamanAscendanceThreshold", text: "Ascendance Threshold", min: 0, max: 100, default: 40 },
        { type: "slider", uid: "RestoShamanSpiritLinkThreshold", text: "Spirit Link Totem Threshold", min: 0, max: 100, default: 30 },
        { type: "slider", uid: "RestoShamanRiptideThreshold", text: "Riptide Threshold", min: 0, max: 100, default: 90 },
        { type: "slider", uid: "RestoShamanHealingWaveThreshold", text: "Healing Wave Threshold", min: 0, max: 100, default: 80 },
        { type: "slider", uid: "RestoShamanChainHealThreshold", text: "Chain Heal Threshold", min: 0, max: 100, default: 70 },
      ]
    }
  ];

  shouldStopCasting() {
    if (!me.isCastingOrChanneling) return false;
    const currentCast = me.currentCastOrChannel;
    if (currentCast.timeleft < 500) return false;

    const isDamageCast = currentCast.name === "Chain Lightning" || currentCast.name === "Lava Burst" || currentCast.name === "Lightning Bolt";
    const isHealCast = currentCast.name === "Healing Wave" || currentCast.name === "Chain Heal";

    if (isDamageCast && this.isHealingNeeded()) return true;
    if (isHealCast && !this.isHealingNeeded() && !this.isEmergencyHealingNeeded()) return true;
    return false;
  }

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      common.waitForCastOrChannel(),
      new bt.Decorator(
        () => this.shouldStopCasting(),
        new bt.Action(() => {
          me.stopCasting();
          return bt.Status.Success;
        })
      ),

      // Buff maintenance
      spell.cast("Skyfury", on => me, req => !me.hasAura("Skyfury") && !me.hasAuraByMe("Ghost Wolf")),
      spell.cast("Water Shield", on => me, req => !me.hasAura("Water Shield") && !me.hasAuraByMe("Ghost Wolf")),
      spell.cast("Earth Shield", on => me, req => !me.hasAura("Earth Shield") && !me.hasAuraByMe("Ghost Wolf")),
      spell.cast("Earthliving Weapon", on => me, req => !me.hasAura(auras.earthlivingWeapon) && !me.hasAuraByMe("Ghost Wolf")),

      // Off-GCD interrupt (30s CD, 4s spell lock -- only healer interrupt in Midnight)
      spell.interrupt("Wind Shear"),

      // Dispels
      spell.dispel("Poison Cleansing Totem", true, DispelPriority.Low, false, WoWDispelType.Poison),
      spell.dispel("Purify Spirit", true, DispelPriority.Low, false, WoWDispelType.Magic),
      spell.dispel("Purify Spirit", true, DispelPriority.Low, false, WoWDispelType.Curse),

      // GCD-gated rotation
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          this.defensiveCooldowns(),
          this.maintainEarthShieldOnTank(),

          new bt.Decorator(
            () => this.isEmergencyHealingNeeded(),
            this.emergencyHealing()
          ),

          new bt.Decorator(
            () => this.isHealingNeeded(),
            this.healingRotation()
          ),

          new bt.Decorator(
            () => me.inCombat() || (this.getTank() && this.getTank().inCombat()),
            this.damageRotation()
          ),
        )
      )
    );
  }

  defensiveCooldowns() {
    return new bt.Selector(
      spell.cast("Astral Shift", on => me, ret =>
        me.inCombat() && me.effectiveHealthPercent < 40),
      spell.cast("Earth Elemental", ret => {
        const tank = this.getTank();
        return me.inCombat() && tank && tank.effectiveHealthPercent < 20;
      }),
    );
  }

  maintainEarthShieldOnTank() {
    return spell.cast("Earth Shield",
      on => this.getActiveTankWithoutEarthShield(),
      req => {
        const target = this.getActiveTankWithoutEarthShield();
        return target && me.distanceTo(target) <= 40 && me.withinLineOfSight(target);
      }
    );
  }

  emergencyHealing() {
    return new bt.Selector(
      // Instant Healing Wave via Nature's Swiftness or Ancestral Swiftness (both guarantee Stormstream proc)
      spell.cast("Nature's Swiftness", on => me),
      spell.cast("Ancestral Swiftness", on => me, req =>
        spell.getTimeSinceLastCast("Ancestral Swiftness") > 2000),
      spell.cast("Healing Wave", on => this.getLowestHealthAlly(), req =>
        me.hasAura(auras.naturesSwiftness) || me.hasAura(auras.ancestralSwiftness)),

      // Spirit Link Totem for group-wide emergency
      spell.cast("Spirit Link Totem", on => this.getBestSpiritLinkTarget(), req => {
        const target = this.getBestSpiritLinkTarget();
        return target && this.getLowestHealthPercentage() < Settings.RestoShamanSpiritLinkThreshold;
      }),

      // Ascendance for sustained emergency throughput
      spell.cast("Ascendance", req => this.getLowestHealthPercentage() < Settings.RestoShamanAscendanceThreshold),

      // Healing Wave fallback
      spell.cast("Healing Wave", on => this.getLowestHealthAlly()),
    );
  }

  healingRotation() {
    return new bt.Selector(
      // Stormstream Totem procs -- highest priority, cast immediately when available
      spell.cast("Stormstream Totem", on => me, req => me.hasAura(auras.stormstreamTotem)),

      // Riptide: spread to allies without it for Deluge/Undercurrent/Flow of the Tides value
      spell.cast("Riptide", on => this.getAllyNeedingRiptide()),

      // Unleash Life on CD (longer CD in Midnight but stronger heal + cast time reduction)
      spell.cast("Unleash Life", on => me, req => {
        const ally = this.getLowestHealthAlly();
        return ally && ally.effectiveHealthPercent < 90;
      }),

      // Ancestral Swiftness -> instant Healing Wave (also guarantees Stormstream proc)
      spell.cast("Ancestral Swiftness", on => me, req => {
        const ally = this.getLowestHealthAlly();
        return ally && ally.effectiveHealthPercent < 80 &&
          spell.getTimeSinceLastCast("Ancestral Swiftness") > 2000;
      }),
      spell.cast("Healing Wave", on => this.getLowestHealthAlly(), req => me.hasAura(auras.ancestralSwiftness)),

      // Healing Stream Totem on cooldown when none active nearby
      new bt.Decorator(
        () => !this.isHealingStreamTotemNearby(),
        spell.cast("Healing Stream Totem", on => me)
      ),

      // Nature's Swiftness -> instant Healing Wave when someone is moderately low
      spell.cast("Nature's Swiftness", on => me, req => {
        const ally = this.getLowestHealthAlly();
        return ally && ally.effectiveHealthPercent < 70 && me.inCombat();
      }),
      spell.cast("Healing Wave", on => this.getLowestHealthAlly(), req => me.hasAura(auras.naturesSwiftness)),

      // During Ascendance: Healing Wave always crits, heals 2nd ally for 50%, mana-positive
      new bt.Decorator(
        () => this.isAscendanceActive(),
        spell.cast("Healing Wave", on => this.getLowestHealthAlly())
      ),

      // Chain Heal when multiple allies injured and mana allows
      spell.cast("Chain Heal", on => this.getBestChainHealTarget(), req => {
        const target = this.getBestChainHealTarget();
        if (!target) return false;
        const alliesNearby = this.getAlliesInRange(target, 30);
        const injuredAllies = alliesNearby.filter(a => a.effectiveHealthPercent < Settings.RestoShamanChainHealThreshold);
        return injuredAllies.length >= 2 && me.pctPower > 20;
      }),

      // Healing Wave filler on lowest-health ally
      spell.cast("Healing Wave", on => this.getLowestHealthAlly(), req => {
        const ally = this.getLowestHealthAlly();
        return ally && ally.effectiveHealthPercent < Settings.RestoShamanHealingWaveThreshold;
      }),
    );
  }

  damageRotation() {
    return new bt.Selector(
      spell.cast("Lava Burst", on => this.getLavaBurstTarget(), req =>
        me.hasAura(auras.lavaSurge) && this.getLavaBurstTarget() !== null),
      spell.cast("Flame Shock", on => this.getFlameShockTarget(), req =>
        this.getFlameShockTarget() !== null),
      spell.cast("Chain Lightning", on => this.getCurrentTarget(), req => {
        const target = this.getCurrentTarget();
        return target && target.getUnitsAroundCount(10) >= 2;
      }),
      spell.cast("Lava Burst", on => this.getLavaBurstTarget(), req =>
        this.getLavaBurstTarget() !== null),
      spell.cast("Lightning Bolt", on => this.getCurrentTarget()),
    );
  }

  // --- State checks ---

  isHealingNeeded() {
    return this.getLowestHealthPercentage() <= 90;
  }

  isEmergencyHealingNeeded() {
    const ally = this.getLowestHealthAlly();
    if (!ally) return false;
    return me.inCombat() && ally.inCombat() && me.withinLineOfSight(ally) &&
      ally.effectiveHealthPercent <= Settings.RestoShamanEmergencyHealingThreshold;
  }

  isAscendanceActive() {
    return me.hasAura(auras.ascendance) || me.hasAura("Ascendance");
  }

  // --- Target helpers ---

  getTank() {
    return heal.friends.Tanks[0] || me;
  }

  getActiveTankWithoutEarthShield() {
    const tanks = heal.friends.Tanks.filter(t => t !== null);
    const activeTank = tanks.find(t =>
      t.isTanking() && !t.hasAura(auras.earthShield) && !t.hasAura(auras.earthShieldPlayer)
    );
    if (activeTank) return activeTank;
    return tanks.find(t => !t.hasAura(auras.earthShield) && !t.hasAura(auras.earthShieldPlayer)) || null;
  }

  getLowestHealthAlly() {
    if (wow.frameTime < this.cachedLowestHealthExpiry && this.cachedLowestHealthAlly) {
      try {
        this.cachedLowestHealthAlly.effectiveHealthPercent;
        return this.cachedLowestHealthAlly;
      } catch {
        this.cachedLowestHealthAlly = null;
        this.cachedLowestHealthExpiry = 0;
      }
    }

    let allies = [...heal.friends.All];
    if (!allies.some(a => a.guid.equals(me.guid))) {
      allies.push(me);
    }
    allies = allies.filter(a => me.withinLineOfSight(a));

    this.cachedLowestHealthAlly = allies
      .sort((a, b) => (a ? a.effectiveHealthPercent : 100) - (b ? b.effectiveHealthPercent : 100))[0] || null;
    this.cachedLowestHealthExpiry = wow.frameTime + 200;
    return this.cachedLowestHealthAlly;
  }

  getLowestHealthPercentage() {
    const ally = this.getLowestHealthAlly();
    return ally ? ally.effectiveHealthPercent : 100;
  }

  getAllyNeedingRiptide() {
    const candidates = heal.friends.All.filter(a =>
      a && !a.hasAuraByMe(auras.riptide) && a.effectiveHealthPercent < Settings.RestoShamanRiptideThreshold
    );
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => a.effectiveHealthPercent - b.effectiveHealthPercent)[0];
  }

  getAlliesInRange(unit, range) {
    let allies = heal.friends.All.filter(a => a && a.distanceTo(unit) <= range);
    if (!allies.some(a => a.guid.equals(me.guid)) && me.distanceTo(unit) <= range) {
      allies.push(me);
    }
    return allies;
  }

  getBestChainHealTarget() {
    return heal.friends.All.reduce((best, current) => {
      if (!current) return best;
      const injured = this.getAlliesInRange(current, 30)
        .filter(a => a.effectiveHealthPercent < Settings.RestoShamanChainHealThreshold);
      if (!best) return current;
      const bestInjured = this.getAlliesInRange(best, 30)
        .filter(a => a.effectiveHealthPercent < Settings.RestoShamanChainHealThreshold);
      if (injured.length > bestInjured.length) return current;
      if (injured.length === bestInjured.length) {
        const currentLowest = Math.min(...injured.map(a => a.effectiveHealthPercent));
        const bestLowest = Math.min(...bestInjured.map(a => a.effectiveHealthPercent));
        return currentLowest < bestLowest ? current : best;
      }
      return best;
    }, null);
  }

  getBestSpiritLinkTarget() {
    return heal.friends.All.reduce((best, current) => {
      if (!current) return best;
      const near = this.getAlliesInRange(current, 12);
      if (near.length > (best ? this.getAlliesInRange(best, 12).length : 0)) return current;
      return best;
    }, null);
  }

  // --- Totem helpers ---

  isHealingStreamTotemNearby() {
    if (!this.isTotemActive("Healing Stream Totem")) return false;
    const totem = this.getTotemByName("Healing Stream Totem");
    return totem && me.distanceTo(totem) <= 30;
  }

  isTotemActive(totemName) {
    if (wow.GameUI.totemInfo) {
      for (let i = 1; i <= 6; i++) {
        const info = wow.GameUI.totemInfo[i];
        if (info && info.name === totemName) return true;
      }
    }
    return false;
  }

  getTotemByName(totemName) {
    if (!this.isTotemActive(totemName)) return null;
    let totem = null;
    objMgr.objects.forEach(obj => {
      if (obj instanceof wow.CGUnit && obj.name === totemName &&
        obj.createdBy && obj.createdBy.equals(me.guid)) {
        totem = obj;
        return false;
      }
    });
    return totem;
  }

  // --- Combat target helpers ---

  getCurrentTarget() {
    const pred = unit =>
      unit && common.validTarget(unit) &&
      unit.distanceTo(me) <= 30 &&
      me.isFacing(unit) &&
      me.withinLineOfSight(unit) &&
      !unit.isImmune();

    const target = me.target;
    if (target !== null && pred(target)) return target;
    return combat.targets.find(pred) || null;
  }

  getFlameShockTarget() {
    if (me.target && me.targetUnit && !me.targetUnit.hasAuraByMe(auras.flameShock)) {
      return me.target;
    }
    const units = me.getUnitsAround(40);
    return units.find(u =>
      u && !u.hasAuraByMe(auras.flameShock) && me.isFacing(u) &&
      u.inCombat() && !u.isImmune() && me.withinLineOfSight(u) && me.canAttack(u)
    ) || null;
  }

  getLavaBurstTarget() {
    if (me.target && me.targetUnit && me.targetUnit.hasAuraByMe(auras.flameShock)) {
      return me.target;
    }
    const units = me.getUnitsAround(40);
    return units.find(u =>
      u && u.hasAuraByMe(auras.flameShock) && me.isFacing(u) &&
      u.inCombat() && !u.isImmune() && me.withinLineOfSight(u) && me.canAttack(u)
    ) || null;
  }
}
