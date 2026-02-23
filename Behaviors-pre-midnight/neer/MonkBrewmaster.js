import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { MovementFlags } from "@/Enums/Flags";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import Settings from "@/Core/Settings";
import { Classification } from "@/Enums/UnitEnums";
import KeyBinding from "@/Core/KeyBinding";

const auras = {
  rjw: 116847,
  freeVivify: 392883,
  healingSphere: 224863,
  harmonicSurge: 1239483,
  blackoutCombo: 228563,
  balancedStratagem: 451508,
  orderBuff: 387184,
  orderDebuff: 387179,
}

const spells = {
  cracklingJadeLightning: 117952
}

export class MonkBrewmasterBehavior extends Behavior {
  name = "Monk [Brewmaster]";
  context = BehaviorContext.Any;
  specialization = Specialization.Monk.Brewmaster;
  static settings = [
    {
      header: "General",
      options: [
        { type: "checkbox", uid: "BrewmasterUseProvoke", text: "Use Provoke", default: false },
        { type: "checkbox", uid: "BrewmasterBlackOxBrewLogic", text: "Black Ox Brew Logic", default: false },
      ]
    },
    {
      header: "Defensives",
      options: [
        { type: "slider", uid: "BrewmasterCelestialInfusionPercent", text: "Celestial Infusion Percent", min: 0, max: 100, default: 80 },
        { type: "slider", uid: "BrewmasterFortfyingBrewPercent", text: "Fortifying Brew Percent", min: 0, max: 100, default: 50 },
        { type: "slider", uid: "BrewmasterExpelHarmPercent", text: "Expel Harm Percent", min: 0, max: 100, default: 60 },
        { type: "slider", uid: "BrewmasterExpelHarmSphereCount", text: "Expel Harm Sphere Count", min: 0, max: 10, default: 4 },
        { type: "checkbox", uid: "BrewmasterDiffuseMagicLogic", text: "Diffuse Magic Logic", default: false },
        { type: "checkbox", uid: "BrewmasterPurifyingBrewLogic", text: "Purifying Brew Logic", default: false },
      ]
    },
    {
      header: "Healing",
      options: [
        { type: "slider", uid: "BrewmasterVivifySelfPercent", text: "[Proc] Vivify Self Percent", min: 0, max: 100, default: 0 },
        { type: "slider", uid: "BrewmasterVivifyFriendPercent", text: "[Proc] Vivify Friend Percent", min: 0, max: 100, default: 0 },
      ]
    },
    {
      header: "Utility",
      options: [
        { type: "hotkey", uid: "MonkBrewmasterPullAll", text: "Pull All With Crackling Jade Lightning", default: null },
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      this.pullAllRotation(),
      common.waitForCastOrChannel(),
      this.interruptRotation(),
      this.tauntRotation(),
      this.defensiveRotation(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          this.healingRotation(),
          common.waitForTarget(),
          this.mainTankingRotation(),
          this.damageRotation()
        )
      )
    );
  }

  pullAllRotation() {
    return new bt.Selector(
      this.cancelCracklingJadeLightning(),
      spell.cast("Crackling Jade Lightning", on => me.getEnemies(40).find(enemy => !enemy.inCombat() && enemy.health > 100 && me.isFacing(enemy)), req => KeyBinding.isBehaviorHotkeyDown("MonkBrewmasterPullAll"))
    );
  }

  cancelCracklingJadeLightning() {
    return new bt.Decorator(
      ret => me.isCastingOrChanneling && this.isCastingCracklingJadeLightning(),
      new bt.Action(_ => {
        me.stopCasting();
        return bt.Status.Success;
      })
    );
  }

  isCastingCracklingJadeLightning() {
    if (!me.isCastingOrChanneling) return false;
    return me.spellInfo.spellChannelId === spells.cracklingJadeLightning;
  }

  interruptRotation() {
    return new bt.Selector(
      spell.interrupt("Spear Hand Strike")
    );
  }

  tauntRotation() {
    return new bt.Selector(
      spell.cast("Provoke", on => this.findTauntTarget(), req => Settings.BrewmasterUseProvoke)
    );
  }

  defensiveRotation() {
    return new bt.Selector(
      spell.cast("Diffuse Magic", on => me, req => this.hasEnemiesCastingOnMe() && Settings.BrewmasterDiffuseMagicLogic),
      spell.cast("Fortifying Brew", on => me, req => me.effectiveHealthPercent <= Settings.BrewmasterFortfyingBrewPercent && this.isInDanger()),
      spell.cast("Purifying Brew", on => me, req => this.shouldUsePurifyingBrew() && Settings.BrewmasterPurifyingBrewLogic),
      spell.cast("Black Ox Brew", on => me, req => this.shouldUseBlackOxBrew() && Settings.BrewmasterBlackOxBrewLogic)
    );
  }

  healingRotation() {
    return new bt.Selector(
      spell.cast("Vivify", on => {
        if (!me.hasAura(auras.freeVivify)) return undefined;

        if (me.effectiveHealthPercent < Settings.BrewmasterVivifySelfPercent) {
          return me;
        }

        const target = heal.priorityList[0];
        return target && target.effectiveHealthPercent < Settings.BrewmasterVivifyFriendPercent ? target : undefined;
      })
    );
  }

  // Spells that you need to use to keep up defensives or some shit
  mainTankingRotation() {
    return new bt.Selector(
      spell.cast("Celestial Infusion", on => me, req => (me.effectiveHealthPercent <= Settings.BrewmasterCelestialInfusionPercent || spell.getCharges("Celestial Infusion") == 2) && this.isInDanger()),
      spell.cast("Expel Harm", on => me, req => this.shouldUseExpelHarm())
    );
  }

  damageRotation() {
    return new bt.Selector(
      common.ensureAutoAttack(),

      // Touch of Death
      spell.cast("Touch of Death"),

      // Blackout Kick priority (when Blackout Combo buff is not up)
      spell.cast("Blackout Kick", on => this.findMeleeTarget(), req => !me.hasAura(auras.blackoutCombo)),

      // Chi Burst if not talented into Aspect of Harmony or if Balanced Stratagem Magic stacks > 3
      spell.cast("Chi Burst", on => this.findMeleeTarget(), req => !this.hasTalent("Aspect of Harmony") || me.getAuraStacks(auras.balancedStratagem) > 3),

      // Weapons of Order
      spell.cast("Weapons of Order", req => me.targetUnit?.classification == Classification.Boss),

      // Invoke Niuzao logic
      spell.cast("Invoke Niuzao", req => !this.hasTalent("Call to Arms")),
      spell.cast("Invoke Niuzao", req => this.hasTalent("Call to Arms") && !me.hasAura("Call to Arms Invoke Niuzao") && this.getAuraRemainingTime("Weapons of Order") < 16),

      // Rising Sun Kick (if not talented into Fluidity of Motion)
      spell.cast("Rising Sun Kick", on => this.findMeleeTarget(), req => !this.hasTalent("Fluidity of Motion")),

      // Keg Smash priority logic
      spell.cast("Keg Smash", on => this.findMeleeTarget(), req => this.shouldUseKegSmashPriority()),

      // Tiger Palm with Blackout Combo
      spell.cast("Tiger Palm", on => this.findMeleeTarget(), req => me.hasAura(auras.blackoutCombo)),

      // Keg Smash with Scalding Brew talent
      spell.cast("Keg Smash", on => this.findMeleeTarget(), req => this.hasTalent("Scalding Brew")),

      // Spinning Crane Kick with Charred Passions and Scalding Brew
      spell.cast("Spinning Crane Kick", on => this.findMeleeTarget(), req => this.shouldUseSpinningCraneKick()),

      // Rising Sun Kick (if talented into Fluidity of Motion)
      spell.cast("Rising Sun Kick", on => this.findMeleeTarget(), req => this.hasTalent("Fluidity of Motion")),

      // Breath of Fire logic
      spell.cast("Breath of Fire", on => this.findMeleeTarget(), req => this.shouldUseBreathOfFire()),

      // Exploding Keg
      spell.cast("Exploding Keg", req => !me.isMoving() && (!this.hasTalent("Rushing Jade Wind") || me.hasAura(auras.rjw))),

      // Rushing Jade Wind with Aspect of Harmony
      spell.cast("Rushing Jade Wind", on => me, req => this.shouldUseRushingJadeWindHarmony()),

      // Standard Keg Smash
      spell.cast("Keg Smash", on => this.findMeleeTarget()),

      // Rushing Jade Wind without Aspect of Harmony
      spell.cast("Rushing Jade Wind", on => me, req => this.shouldUseRushingJadeWindStandard()),

      // Tiger Palm energy management
      spell.cast("Tiger Palm", on => this.findMeleeTarget(), req => this.shouldUseTigerPalmEnergy()),

      // Spinning Crane Kick energy management
      spell.cast("Spinning Crane Kick", on => this.findMeleeTarget(), req => this.shouldUseSpinningCraneKickEnergy()),

      // Fallback Tiger Palm
      spell.cast("Tiger Palm", on => this.findMeleeTarget(), req => me.pctPower >= 45 || this.noKegIncoming())
    );
  }

  findTauntTarget() {
    return combat.targets.find(unit => me.distanceTo(unit) > 10 && unit.inCombat() && unit.target && !unit.isTanking());
  }

  isInDanger() {
    return combat.targets.find(unit => unit.isTanking());
  }

  hasEnemiesCastingOnMe() {
    const enemiesCasting = combat.targets.filter(enemy => {
      if (enemy.isCastingOrChanneling && enemy.spellInfo) {
        const target = enemy.spellInfo.spellTargetGuid;
        if (target && target.equals(me.guid)) {
          const castRemains = enemy.spellInfo.castEnd - wow.frameTime;
          return castRemains < 1500;
        }
      }
      return false;
    });
    return enemiesCasting.length > 1;
  }

  shouldUseExpelHarm() {
    const healthThreshold = me.effectiveHealthPercent <= Settings.BrewmasterExpelHarmPercent;
    const inDanger = this.isInDanger();
    const hasEnoughSpheres = me.getAura(auras.healingSphere)?.stacks >= Settings.BrewmasterExpelHarmSphereCount;

    return healthThreshold && inDanger && hasEnoughSpheres;
  }

  shouldUsePurifyingBrew() {
    const charges = spell.getCharges("Purifying Brew");
    const hasModerateStagger = me.hasAura("Moderate Stagger");
    const hasHeavyStagger = me.hasAura("Heavy Stagger");

    if (charges === 2) {
      return hasModerateStagger || hasHeavyStagger;
    } else if (charges === 1) {
      return hasHeavyStagger;
    }

    return false;
  }

  shouldUseBlackOxBrew() {
    const infusinCD = spell.getCooldown("Celestial Infusion").timeleft;
    const purifyCharges = spell.getCharges("Purifying Brew");
    const energy = me.pctPower;

    return infusinCD > 2000 && purifyCharges == 0 && energy < 90;
  }

  noKegIncoming() {
    const kegCharges = spell.getCharges("Keg Smash");
    const kegCD = spell.getCooldown("Keg Smash").timeleft;

    return kegCharges == 0 && kegCD > 2000;
  }

  findMeleeTarget() {
    return me.isWithinMeleeRange(combat.bestTarget) ? combat.bestTarget : null;
  }

  // New helper methods for damage rotation
  shouldUseKegSmashPriority() {
    if (!me.hasAura(auras.orderBuff)) return false;

    const weaponsDebuff = me.targetUnit?.getAura(auras.orderDebuff);
    const blackoutCombo = me.hasAura(auras.blackoutCombo);
    const risingSunKickCD = spell.getCooldown("Rising Sun Kick").timeleft;

    // Check if debuff is about to expire
    if (weaponsDebuff && weaponsDebuff.remaining < 1.8) return true;

    // Check if debuff stacks are low
    if (weaponsDebuff && weaponsDebuff.stacks < (3 - (blackoutCombo ? 1 : 0))) return true;

    // Check if Weapons of Order buff is about to expire
    const weaponsBuff = me.getAura(auras.orderBuff);
    if (weaponsBuff && weaponsBuff.remaining < (3 - (blackoutCombo ? 1 : 0)) && weaponsBuff.remaining < (1 + risingSunKickCD)) return true;

    return false;
  }

  shouldUseSpinningCraneKick() {
    if (!this.hasTalent("Charred Passions") || !this.hasTalent("Scalding Brew")) return false;

    const charredPassions = me.getAura("Charred Passions");
    const breathOfFire = me.targetUnit?.getAura("Breath of Fire");
    const enemiesInRange = this.getEnemiesInRange(8);

    return charredPassions &&
      charredPassions.remaining < 3 &&
      breathOfFire && breathOfFire.remaining < 9 &&
      enemiesInRange > 4;
  }

  shouldUseBreathOfFire() {
    const charredPassions = me.getAura("Charred Passions");
    const scaldingBrew = this.hasTalent("Scalding Brew");
    const breathOfFire = me.targetUnit?.getAura("Breath of Fire");
    const enemiesInRange = this.getEnemiesInRange(12);

    // Use if Charred Passions is down and either no Scalding Brew or less than 5 enemies
    if (!charredPassions && (!scaldingBrew || enemiesInRange < 5)) return true;

    // Use if no Charred Passions talent
    if (!this.hasTalent("Charred Passions")) return true;

    // Use if Breath of Fire dot is about to expire and we have Scalding Brew
    if (breathOfFire && breathOfFire.remaining < 3 && scaldingBrew) return true;

    return false;
  }

  shouldUseRushingJadeWindHarmony() {
    if (!this.hasTalent("Aspect of Harmony")) return false;

    const rjw = me.getAura(auras.rjw);
    return (!rjw || rjw.remaining < 2.5);
  }

  shouldUseRushingJadeWindStandard() {
    if (this.hasTalent("Aspect of Harmony")) return false;

    const rjw = me.getAura(auras.rjw);
    return (!rjw || rjw.remaining < 2.5);
  }

  shouldUseTigerPalmEnergy() {
    const energy = me.pctPower;
    const kegSmashCD = spell.getCooldown("Keg Smash").timeleft;
    const energyRegen = 10; // Approximate energy regen per second

    return energy > (40 - (kegSmashCD / 1000) * energyRegen);
  }

  shouldUseSpinningCraneKickEnergy() {
    const energy = me.pctPower;
    const kegSmashCD = spell.getCooldown("Keg Smash").timeleft;
    const energyRegen = 10; // Approximate energy regen per second

    return energy > (40 - (kegSmashCD / 1000) * energyRegen);
  }

  getEnemiesInRange(range) {
    return combat.getUnitsAroundUnit(me, range).length;
  }

  hasTalent(talentName) {
    return me.hasAura(talentName);
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }
}
