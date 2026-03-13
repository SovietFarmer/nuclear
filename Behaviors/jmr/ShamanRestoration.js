import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import objMgr, { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import Settings from "@/Core/Settings";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";

const HEALING_RAIN_RADIUS = 11;
const HEALING_STREAM_TOTEM_RANGE = 30;
const HEALING_RAIN_COOLDOWN = 500; // 500ms cooldown, adjust as needed

export class ShamanRestorationBehavior extends Behavior {
  name = "Restoration Shaman";
  context = BehaviorContext.Any;
  specialization = Specialization.Shaman.Restoration;
  lastHealingStreamTotemCast = 0;
  lastHealingRainCast = 0;
  lastHealingStreamTotemCast = 0;
  //static HEALING_STREAM_TOTEM_COOLDOWN = 18000;
  static HEALING_STREAM_TOTEM_NAME = "Healing Stream Totem";

  constructor() {
    super();
    this.lastHealingCheck = 0;
    this.lastDamageCheck = 0;
    this.lastTotemCheck = 0;
    this.cachedLowestHealthAlly = null;
    this.cachedLowestHealthExpiry = 0;
  }

  getActiveTankWithoutEarthShield() {
    const tanks = heal.friends.Tanks;

    // First, try to find an active tank without Earth Shield
    const activeTankWithoutShield = tanks.find(tank =>
      tank.isTanking() && !tank.hasAura("Earth Shield")
    );

    if (activeTankWithoutShield) {
      return activeTankWithoutShield;
    }

    // If no active tank without shield, just return any tank without shield
    return tanks.find(tank => !tank.hasAura("Earth Shield"));
  }

  static settings = [
    {
      type: "slider",
      uid: "RestoShamanEmergencyHealingThreshold",
      text: "Emergency Healing Threshold",
      min: 0,
      max: 100,
      default: 30
    },
    {
      type: "slider",
      uid: "RestoShamanAncestralGuidanceThreshold",
      text: "Ancestral Guidance Threshold",
      min: 0,
      max: 100,
      default: 40
    },
    {
      type: "slider",
      uid: "RestoShamanAscendanceThreshold",
      text: "Ascendance Threshold",
      min: 0,
      max: 100,
      default: 40
    },
    {
      type: "slider",
      uid: "RestoShamanSpiritLinkThreshold",
      text: "Spirit Link Totem Threshold",
      min: 0,
      max: 100,
      default: 30
    },
    {type: "slider", uid: "RestoShamanRiptideThreshold", text: "Riptide Threshold", min: 0, max: 100, default: 70},
    {
      type: "slider",
      uid: "RestoShamanHealingSurgeThreshold",
      text: "Healing Surge Threshold",
      min: 0,
      max: 100,
      default: 50
    },
    {
      type: "slider",
      uid: "RestoShamanHealingWaveThreshold",
      text: "Healing Wave Threshold",
      min: 0,
      max: 100,
      default: 50
    },
    {
      type: "slider",
      uid: "RestoShamanPrimordialWaveThreshold",
      text: "Primordial Wave Threshold",
      min: 0,
      max: 100,
      default: 40
    },
    {type: "slider", uid: "RestoShamanChainHealThreshold", text: "Chain Heal Threshold", min: 0, max: 100, default: 60},
  ];

  shouldStopCasting() {
    if (!me.isCastingOrChanneling) return false;

    const currentCast = me.currentCastOrChannel;
    const remainingCastTime = currentCast.timeleft;

    // If the cast is almost complete (less than 0.5 seconds remaining), let it finish
    if (remainingCastTime < 500) return false;

    const isDamageCast = currentCast.name === "Chain Lightning" || currentCast.name === "Lava Burst";
    const isHealCast = currentCast.name === "Healing Wave" || currentCast.name === "Healing Surge" || currentCast.name === "Chain Heal";

    if (isDamageCast && (this.isHealingNeeded() || this.isEmergencyHealingNeeded())) {
      return true;
    }

    if (isHealCast && !this.isHealingNeeded() && !this.isEmergencyHealingNeeded()) {
      return true;
    }

    return false;
  }

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      common.waitForNotSitting(),
      new bt.Decorator(
        () => this.shouldStopCasting(),
        new bt.Action(() => {
          me.stopCasting();
          return bt.Status.Success;
        })
      ),
      spell.cast("Skyfury", on => me, req => !me.hasVisibleAura("Skyfury") && !me.hasVisibleAura("Ghost Wolf")),
      spell.cast("Water Shield", on => me, req => !me.hasVisibleAura("Water Shield") && !me.hasVisibleAura("Ghost Wolf")),
      spell.cast("Earth Shield", on => me, req => !me.hasVisibleAura("Earth Shield") && !me.hasVisibleAura("Ghost Wolf")),
      spell.cast("Earthliving Weapon", on => me, req => !me.hasAura(382022) && !me.hasVisibleAura("Ghost Wolf")),
      spell.cast("Astral Shift", req => me.inCombat() && me.effectiveHealthPercent < 40 && !me.hasVisibleAura("Ghost Wolf")),
      spell.cast("Stone Bulwark Totem", req => me.inCombat() && me.effectiveHealthPercent < 40 && !me.hasVisibleAura("Astral Shift") && !me.hasVisibleAura("Ghost Wolf")),
      spell.cast("Earth Elemental", req => {
        const tank = this.getTank();
        return me.inCombat() && tank && tank.effectiveHealthPercent < 20 && !me.hasVisibleAura("Ghost Wolf");
      }),
      spell.interrupt("Wind Shear"),
      spell.dispel("Poison Cleansing Totem", true, DispelPriority.Low, false, WoWDispelType.Poison),
      spell.dispel("Purify Spirit", true, DispelPriority.Low, false, WoWDispelType.Magic),
      spell.dispel("Purify Spirit", true, DispelPriority.Low, false, WoWDispelType.Curse),
      spell.cast("Earth Shield", on => this.getActiveTankWithoutEarthShield(), req => {
        const activeTankWithoutShield = this.getActiveTankWithoutEarthShield();
        return activeTankWithoutShield && !me.hasVisibleAura("Ghost Wolf") && me.distanceTo(activeTankWithoutShield) <= 40 && me.inMythicPlus() && me.withinLineOfSight(activeTankWithoutShield);
      }),
      new bt.Decorator(
        () => this.isEmergencyHealingNeeded() && (me.inCombat() || this.getTank() && this.getTank().inCombat()) && wow.frameTime - this.lastHealingCheck > 200,
        this.emergencyHealing()
      ),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown() || !me.inMythicPlus(),
        new bt.Selector(
          new bt.Decorator(
            () => this.isHealingNeeded() && (me.inCombat() || this.getTank() && this.getTank().inCombat() || this.getLowestHealthAlly() && this.getLowestHealthAlly().effectiveHealthPercent < 90) && wow.frameTime - this.lastHealingCheck > 200,
            new bt.Selector(
              this.manageTotemProjection(),
              this.healingRotation()
            )
          ),
          new bt.Decorator(
            () => (me.inCombat() || this.getTank() && this.getTank().inCombat()) && wow.frameTime - this.lastDamageCheck > 200 && me.pctPower > 15,
            new bt.Selector(
              this.damageRotation()
            ), "Damage Rotation"
          ),
        )
      )
    );
  }

  isHealingNeeded() {
    const lowestHealth = this.getLowestHealthPercentage();
    if (lowestHealth > 90) return false;
    if (lowestHealth <= 90 ||
      lowestHealth < Settings.RestoShamanEmergencyHealingThreshold ||
      lowestHealth < Settings.RestoShamanAncestralGuidanceThreshold ||
      lowestHealth < Settings.RestoShamanAscendanceThreshold ||
      lowestHealth < Settings.RestoShamanRiptideThreshold ||
      lowestHealth < Settings.RestoShamanHealingSurgeThreshold ||
      lowestHealth < Settings.RestoShamanHealingWaveThreshold ||
      lowestHealth < Settings.RestoShamanPrimordialWaveThreshold ||
      lowestHealth < Settings.RestoShamanChainHealThreshold) return true;
  }

  isEmergencyHealingNeeded() {
    const lowestHealth = this.getLowestHealthPercentage();
    return me.inCombat() && this.getLowestHealthAlly().inCombat() && me.withinLineOfSight(this.getLowestHealthAlly()) &&
      lowestHealth <= Settings.RestoShamanEmergencyHealingThreshold;
  }

  emergencyHealing() {
    return new bt.Selector(
      common.useEquippedItemByName("Spymaster's Web"),
      common.useEquippedItemByName("Imperfect Ascendancy Serum"),
      spell.cast("Nature's Swiftness", on => me),
      spell.cast("Healing Wave", on => this.getLowestHealthAlly(), req => me.hasAura("Nature's Swiftness")),
      spell.cast("Healing Tide Totem"),
      // spell.cast("Spirit Link Totem", on => this.getBestSpiritLinkTarget(), req => this.shouldUseSpiritLinkTotem()),
      spell.cast("Ascendance", req => this.getLowestHealthPercentage() < Settings.RestoShamanAscendanceThreshold),
      spell.cast("Ancestral Guidance", req => this.getLowestHealthPercentage() < Settings.RestoShamanAncestralGuidanceThreshold),
      spell.cast("Healing Surge", on => this.getLowestHealthAlly())
    );
  }

  healingRotation() {
    return new bt.Selector(
      new bt.Decorator(
        () => this.shouldStopCasting(),
        new bt.Action(() => {
          me.stopCasting();
          return bt.Status.Success;
        })
      ),
      new bt.Decorator(
        () => me.inCombat() && this.getLowestHealthAlly() &&
          this.getLowestHealthAlly().inCombat() &&
          this.getLowestHealthAlly().effectiveHealthPercent <= Settings.RestoShamanEmergencyHealingThreshold,
        this.emergencyHealing()
      ),
      new bt.Decorator(
        () => !this.isHealingRainActive() && wow.frameTime - this.lastHealingRainCast > HEALING_RAIN_COOLDOWN && (this.getLowestHealthAlly().effectiveHealthPercent > 90 || me.hasAura("Surging Totem")),
        new bt.Selector(
          spell.cast("Healing Rain", on => this.getBestHealingRainPosition(), req => {
            const bestPosition = this.getBestHealingRainPosition();
            return bestPosition !== null;
          }),
          new bt.Action(() => {
            this.lastHealingRainCast = wow.frameTime;
            return bt.Status.Success;
          })
        )
      ),
      spell.cast("Downpour", on => this.getBestDownpourTarget(), req => {
        const healingRainTotem = this.getTotemByName("Healing Rain");
        const surgingTotem = this.getTotemByName("Surging Totem");

        const checkDamagedAlliesAroundTotem = (totem) => {
          if (!totem) return false;
          const alliesNearTotem = this.getAlliesInRange(totem, 11);
          return alliesNearTotem.some(ally => ally.effectiveHealthPercent < 90);
        };

        return checkDamagedAlliesAroundTotem(healingRainTotem) || checkDamagedAlliesAroundTotem(surgingTotem);
      }),
      spell.cast("Riptide", on => this.getAllyNeedingRiptide()),
      new bt.Decorator(
        () => !this.isHealingStreamTotemNearby() && this.canCastHealingStreamTotem(),
        spell.cast("Healing Stream Totem", on => me)
      ),
      spell.cast("Primordial Wave", on => this.getAllyNeedingRiptide(), req => {
        const lowestHealthAlly = this.getLowestHealthAlly();
        return lowestHealthAlly && lowestHealthAlly.effectiveHealthPercent < Settings.RestoShamanPrimordialWaveThreshold;
      }),
      spell.cast("Nature's Swiftness", on => me, req => {
        const lowestHealthAlly = this.getLowestHealthAlly();
        return lowestHealthAlly && lowestHealthAlly.effectiveHealthPercent < 85 && me.inCombat();
      }),
      spell.cast("Ancestral Swiftness", on => me, req => {
        const lowestHealthAlly = this.getLowestHealthAlly();
        return lowestHealthAlly && lowestHealthAlly.effectiveHealthPercent < 85 && me.hasAura("Ancestral Swiftness");
      }),
      spell.cast("Unleash Life", on => me, req => {
        const lowestHealthAlly = this.getLowestHealthAlly();
        return lowestHealthAlly && lowestHealthAlly.effectiveHealthPercent < 85;
      }),
      spell.cast("Chain Heal", on => this.getBestChainHealTarget(), req => {
        const target = this.getBestChainHealTarget();
        if (!target) return false;

        const alliesNearby = this.getAlliesInRange(target, 30);
        const injuredAllies = alliesNearby.filter(ally => ally.effectiveHealthPercent < Settings.RestoShamanChainHealThreshold);

        return (injuredAllies.length >= 3 ||
            (injuredAllies.length >= 2 &&
          me.hasVisibleAura("High Tide")));
      }),
      spell.cast("Healing Wave", on => this.getLowestHealthAlly(), req => {
        const lowestHealthAlly = this.getLowestHealthAlly();
        return lowestHealthAlly && lowestHealthAlly.effectiveHealthPercent < 80 && me.hasVisibleAura("Primordial Wave");
      }),
      spell.cast("Healing Surge", on => this.getLowestHealthAlly(), req => {
        const lowestHealthAlly = this.getLowestHealthAlly();
        return lowestHealthAlly && lowestHealthAlly.effectiveHealthPercent < 70 && !me.hasVisibleAura("Nature's Swiftness") && me.hasVisibleAura("Master of the Elements");
      }),
      spell.cast("Healing Surge", on => this.getLowestHealthAlly(), req => {
        const lowestHealthAlly = this.getLowestHealthAlly();
        return lowestHealthAlly && lowestHealthAlly.effectiveHealthPercent < Settings.RestoShamanHealingSurgeThreshold && !me.hasVisibleAura("Nature's Swiftness");
      }),
      spell.cast("Healing Wave", on => this.getLowestHealthAlly(), req => {
        const lowestHealthAlly = this.getLowestHealthAlly();
        return lowestHealthAlly && lowestHealthAlly.effectiveHealthPercent < Settings.RestoShamanHealingWaveThreshold;
      }),
      spell.cast("Wellspring", on => this.getLowestHealthAlly()),
    );
  }

  damageRotation() {
    return new bt.Selector(
      new bt.Decorator(
        () => this.shouldStopCasting(),
        new bt.Action(() => {
          me.stopCasting();
          return bt.Status.Success;
        })
      ),
      new bt.Decorator(
        () => !this.isHealingRainActive() && wow.frameTime - this.lastHealingRainCast > HEALING_RAIN_COOLDOWN,
        new bt.Selector(
          spell.cast("Healing Rain", on => this.getBestHealingRainPosition(), req => {
            const bestPosition = this.getBestHealingRainPosition();
            return bestPosition !== null;
          }),
          new bt.Action(() => {
            this.lastHealingRainCast = wow.frameTime;
            return bt.Status.Success;
          })
        )
      ),
      spell.cast("Lava Burst", on => this.getLavaBurstTarget(), req => me.hasVisibleAura("Lava Surge") && this.getLavaBurstTarget() !== null),
      spell.cast("Flame Shock", on => this.getFlameShockTarget(), req => this.getFlameShockTarget() !== null),
      spell.cast("Chain Lightning", on => this.getCurrentTarget(), req => {
        const target = this.getCurrentTarget();
        return target && target.getUnitsAroundCount(10) >= 2;
      }),
      spell.cast("Lava Burst", on => this.getLavaBurstTarget(), req => this.getLavaBurstTarget() !== null),
      spell.cast("Lightning Bolt", on => this.getCurrentTarget())
    );
  }

  manageTotemProjection() {
    return new bt.Selector(
      spell.cast("Totemic Projection", req => {
        const healingRain = this.getTotemByName("Surging Totem");
        const spiritLink = this.getTotemByName("Spirit Link Totem");
        const healingStream = this.getTotemByName("Healing Stream Totem");

        if (healingRain && me.hasAura("Surging Totem") && this.shouldMoveTotem(healingRain, HEALING_RAIN_RADIUS)) {
          return true;
        }

        if (spiritLink && this.shouldMoveTotem(spiritLink, 12)) {
          return true;
        }

        return false;
      })
    );
  }

  // Check if a totem is active using totemInfo (more efficient)
  isTotemActive(totemName) {
    if (wow.GameUI.totemInfo) {
      for (let i = 1; i <= 6; i++) {
        const totemInfo = wow.GameUI.totemInfo[i];
        if (totemInfo && totemInfo.name === totemName) {
          return true;
        }
      }
    }
    return false;
  }
  
  // Get totem duration using totemInfo
  getTotemDuration(totemName) {
    if (wow.GameUI.totemInfo) {
      for (let i = 1; i <= 6; i++) {
        const totemInfo = wow.GameUI.totemInfo[i];
        if (totemInfo && totemInfo.name === totemName) {
          return totemInfo.duration || 0;
        }
      }
    }
    return 0;
  }

  getTotemByName(totemName) {
    // First check if totem exists using efficient totemInfo
    if (!this.isTotemActive(totemName)) {
      return null;
    }
    
    // If we need the actual object (for position/distance), search for it
    let totem = null;
    objMgr.objects.forEach(obj => {
      if (obj instanceof wow.CGUnit &&
        obj.name === totemName &&
        obj.createdBy && obj.createdBy.equals(me.guid)) {
        totem = obj;
        return false; // Break the loop
      }
    });
    return totem;
  }

  shouldMoveTotem(totem, desiredRange) {
    const alliesInRange = this.getAlliesInRange(totem, desiredRange);
    return alliesInRange.length === 0;
  }

  isHealingStreamTotemNearby() {
    const totem = this.getTotemByName("Healing Stream Totem");
    if (totem) {
      const distance = me.distanceTo(totem);
      //console.info(`Healing Stream Totem found. Distance: ${distance.toFixed(2)} yards, Range: ${HEALING_STREAM_TOTEM_RANGE} yards`);
      if (distance <= HEALING_STREAM_TOTEM_RANGE) {
        this.lastHealingStreamTotemCast = wow.frameTime; // Update last cast time
        return true;
      }
    }
    // console.info("No Healing Stream Totem found");
    return false;
  }

  canCastHealingStreamTotem() {
    const currentTime = wow.frameTime;
    const timeSinceLastCast = currentTime - this.lastHealingStreamTotemCast;
    return timeSinceLastCast >= 1500; // 1500ms = 1.5s
  }

  isHealingRainActive() {
    const totem = me.hasAura("Surging Totem") && this.getTotemByName("Surging Totem") || this.getTotemByName("Healing Rain");
    if (totem) {
      const alliesInRange = this.getAlliesInRange(totem, HEALING_RAIN_RADIUS);
      // console.info(`Healing Rain found. Allies in range: ${alliesInRange.length}`);
      return alliesInRange.length > 0;
    }
    // console.info("No Healing Rain found");
    return false;
  }

  isSpiritLinkTotemActive() {
    const totem = this.getTotemByName("Spirit Link Totem");
    if (totem) {
      const alliesInRange = this.getAlliesInRange(totem, 12);
      // console.info(`Spirit Link Totem found. Allies in range: ${alliesInRange.length}`);
      return alliesInRange.length > 0;
    }
    // console.info("No Spirit Link Totem found");
    return false;
  }

  getAlliesInRange(unit, range) {
    let allies = heal.friends.All.filter(ally => ally && ally.distanceTo(unit) <= range);

    // Check if 'me' is already in the list
    const selfIncluded = allies.some(ally => ally.guid.equals(me.guid));

    // If 'me' is not in the list and is within range, add it
    if (!selfIncluded && me.distanceTo(unit) <= range) {
      allies.push(me);
    }

    return allies;
  }

  getAverageHealthPercentage(allies) {
    if (allies.length === 0) return 100;
    const totalHealth = allies.reduce((sum, ally) => sum + (ally ? ally.effectiveHealthPercent : 0), 0);
    return totalHealth / allies.length;
  }

  getTank() {
    return heal.friends.Tanks[0] || me; // Fallback to 'me' if no tank is found
  }

  getLowestHealthAlly() {
    if (wow.frameTime < this.cachedLowestHealthExpiry) {
      try {
        // Try to access the cached unit to ensure it's still valid
        if (this.cachedLowestHealthAlly) {
          // Test if the unit is still valid by accessing a property
          this.cachedLowestHealthAlly.effectiveHealthPercent;
          return this.cachedLowestHealthAlly;
        }
      } catch (error) {
        // Unit has been invalidated, clear cache and fall through to recalculate
        this.cachedLowestHealthAlly = null;
        this.cachedLowestHealthExpiry = 0;
      }
    }

    let allies = [...heal.friends.All];
    if (!allies.some(ally => ally.guid.equals(me.guid))) {
      allies.push(me);
    }
    allies = allies.filter(ally => me.withinLineOfSight(ally));

    this.cachedLowestHealthAlly = allies.sort((a, b) => (a ? a.effectiveHealthPercent : 100) - (b ? b.effectiveHealthPercent : 100))[0] || null;
    this.cachedLowestHealthExpiry = wow.frameTime + 200;

    return this.cachedLowestHealthAlly;
  }

  getLowestHealthPercentage() {
    const lowestHealthAlly = this.getLowestHealthAlly();
    if (lowestHealthAlly === undefined || lowestHealthAlly === null) {
      return 100;
    } else {
      return lowestHealthAlly.effectiveHealthPercent;
    }
  }

  getAllyNeedingRiptide() {
    return heal.friends.All.find(ally =>
      ally && ally.effectiveHealthPercent < Settings.RestoShamanRiptideThreshold && !ally.hasVisibleAura("Riptide")
    ) || null;
  }

  getDamagedAlliesCount(range = 40) {
    const lowestHealthAlly = this.getLowestHealthAlly();
    return lowestHealthAlly ? heal.friends.All.filter(ally =>
      ally && ally.effectiveHealthPercent < 100 && ally.distanceTo(lowestHealthAlly) <= range
    ).length : 0;
  }

  bestTarget() {
    return combat.bestTarget || me.target;
  }

  getCurrentTarget() {
    const targetPredicate = unit =>
      unit && common.validTarget(unit) &&
      unit.distanceTo(me) <= 30 &&
      me.isFacing(unit) &&
      me.withinLineOfSight(unit) &&
      !unit.isImmune();

    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  getFlameShockTarget() {
    if (me.target && me.targetUnit && !me.targetUnit.hasAuraByMe("Flame Shock")) {
      return me.target;
    }

    const units = me.getUnitsAround(40);
    return units.find(unit => unit && !unit.hasAuraByMe("Flame Shock") && me.isFacing(unit) && unit.inCombat() && !unit.isImmune() && me.withinLineOfSight(unit) && me.canAttack(unit)) || null;
  }

  getAttackableUnitsAroundUnit(unit, range) {
    if (!unit) return 0;
    const units = me.getUnitsAround(range);
    return units.filter(u => u && u.distanceTo(unit) <= range && me.canAttack(u) && !u.isImmune()).length;
  }

  getLavaBurstTarget() {
    if (me.target && me.targetUnit && me.targetUnit.hasAuraByMe("Flame Shock")) {
      return me.target;
    }

    const units = me.getUnitsAround(40);
    return units.find(unit => unit && unit.hasAuraByMe("Flame Shock") && me.isFacing(unit) && unit.inCombat() && !unit.isImmune() && me.withinLineOfSight(unit) && me.canAttack(unit)) || null;
  }

  getAlliesInRange(unit, range) {
    let allies = heal.friends.All.filter(ally => ally && ally.distanceTo(unit) <= range);
    if (!allies.some(ally => ally.guid.equals(me.guid)) && me.distanceTo(unit) <= range) {
      allies.push(me);
    }
    return allies;
  }

  getBestChainHealTarget() {
    return heal.friends.All.reduce((best, current) => {
      if (!current) return best;
      const alliesNearby = this.getAlliesInRange(current, 12);
      const injuredAllies = alliesNearby.filter(ally => ally.effectiveHealthPercent < Settings.RestoShamanChainHealThreshold);

      if (!best) return current;

      const bestInjuredAllies = this.getAlliesInRange(best, 12).filter(ally => ally.effectiveHealthPercent < Settings.RestoShamanChainHealThreshold);

      if (injuredAllies.length > bestInjuredAllies.length) {
        return current;
      } else if (injuredAllies.length === bestInjuredAllies.length) {
        const currentLowestHealth = Math.min(...injuredAllies.map(ally => ally.effectiveHealthPercent));
        const bestLowestHealth = Math.min(...bestInjuredAllies.map(ally => ally.effectiveHealthPercent));
        return currentLowestHealth < bestLowestHealth ? current : best;
      }

      return best;
    }, null);
  }

  getBestHealingRainTarget() {
    return heal.friends.All.reduce((best, current) => {
      if (!current) return best;
      const alliesNear = this.getAlliesInRange(current, HEALING_RAIN_RADIUS);
      if (alliesNear.length > (best ? this.getAlliesInRange(best, HEALING_RAIN_RADIUS).length : 0)) {
        return current;
      }
      return best;
    }, null);
  }

  getBestHealingRainPosition() {
    const allUnits = [...heal.friends.All, ...combat.targets];
    const tank = this.getTank();
    const hasAcidRain = me.hasAura("Acid Rain");

    let bestPosition = null;
    let maxUnitsInRange = 0;

    // Function to count units within range of a position
    const countUnitsInRange = (position, units) => {
      return units.filter(unit => unit.distanceTo(position) <= HEALING_RAIN_RADIUS).length;
    };

    // Check each unit's position as a potential center
    allUnits.forEach(centerUnit => {
      const position = centerUnit.position;
      let unitsInRange;

      if (hasAcidRain) {
        // Count both friends and enemies
        unitsInRange = countUnitsInRange(position, allUnits);
      } else {
        // Count only friends, but ensure tank is included
        const friendsInRange = countUnitsInRange(position, heal.friends.All);
        if (tank && tank.distanceTo(position) <= HEALING_RAIN_RADIUS) {
          unitsInRange = friendsInRange;
        } else {
          unitsInRange = 0; // Don't consider positions without the tank
        }
      }

      if (unitsInRange > maxUnitsInRange) {
        maxUnitsInRange = unitsInRange;
        bestPosition = position;
      }
    });

    return bestPosition;
  }

  getBestSpiritLinkTarget() {
    return heal.friends.All.reduce((best, current) => {
      if (!current) return best;
      const alliesNear = this.getAlliesInRange(current, 12);
      if (alliesNear.length > (best ? this.getAlliesInRange(best, 12).length : 0)) {
        return current;
      }
      return best;
    }, null);
  }

  shouldUseSpiritLinkTotem() {
    const alliesInDanger = heal.friends.All.filter(ally => ally && ally.effectiveHealthPercent < Settings.RestoShamanSpiritLinkThreshold && this.getAlliesInRange(ally, 8).length >= 4);
    return alliesInDanger;
  }

  getBestDownpourTarget() {
    const healingRainTotem = this.getTotemByName("Healing Rain");
    const surgingTotem = this.getTotemByName("Surging Totem");

    const findBestTargetAroundTotem = (totem) => {
      if (!totem) return null;
      const alliesNearTotem = this.getAlliesInRange(totem, 11);
      return alliesNearTotem.reduce((best, current) => {
        if (current.effectiveHealthPercent < 90 && (!best || current.effectiveHealthPercent < best.effectiveHealthPercent)) {
          return current;
        }
        return best;
      }, null);
    };

    const targetNearHealingRain = findBestTargetAroundTotem(healingRainTotem);
    const targetNearSurgingTotem = findBestTargetAroundTotem(surgingTotem);

    // Return the target with lower health, or null if no valid targets
    return (targetNearHealingRain && targetNearSurgingTotem)
      ? (targetNearHealingRain.effectiveHealthPercent < targetNearSurgingTotem.effectiveHealthPercent ? targetNearHealingRain : targetNearSurgingTotem)
      : (targetNearHealingRain || targetNearSurgingTotem);
  }

  getTanks() {
    return heal.friends.Tanks.filter(tank => tank !== null);
  }

  getActiveTankWithoutEarthShield() {
    const tanks = this.getTanks();

    // First, try to find an active tank without Earth Shield
    const activeTankWithoutShield = tanks.find(tank =>
      tank.isTanking() && !tank.hasAura("Earth Shield")
    );

    if (activeTankWithoutShield) {
      return activeTankWithoutShield;
    }

    // If no active tank without shield, just return any tank without shield
    return tanks.find(tank => !tank.hasAura("Earth Shield"));
  }
}
