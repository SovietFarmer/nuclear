import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import spell from "@/Core/Spell";
import objMgr, { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as Combat } from "@/Targeting/CombatTargeting";
import Specialization from "@/Enums/Specialization";
import common from "@/Core/Common";
import Settings from "@/Core/Settings";
import { PowerType } from "@/Enums/PowerType";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";

const auras = {
  moonkinForm: 24858,
  bearForm: 5487,
  travelForm: 783,
  solarEclipse: 48517,
  lunarEclipse: 48518,
  dreamstate: 194223,
  celestialAlignment: 194223,
  incarnationChosenOfElune: 102560,
  warriorOfElune: 202425,
  starlord: 279709,
  balanceOfAllThings: 394049,
  touchTheCosmos: 394414,
  starweaversWarp: 393942,
  starweaversWeft: 393944,
  furyOfElune: 202770,
  convoke: 391528,
  sunfire: 164815,
  moonfire: 164812,
  stellarFlare: 202347,
  fungalGrowth: 81291,
  umbralEmbrace: 393760,
  harmonyOfTheGrove: 428731,
  newMoon: 274281,
  halfMoon: 274282,
  fullMoon: 274283,
};

export class DruidBalance extends Behavior {
  name = "Druid (Balance) PVE";
  context = BehaviorContext.Any;
  specialization = Specialization.Druid.Balance;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: 'Balance Druid PvE Settings',
      options: [
        {type: 'checkbox', uid: 'BalanceDruidUseOffensiveCooldown', text: 'Use Offensive Cooldowns', default: true},
        {type: 'checkbox', uid: 'BalanceDruidUseDefensiveCooldown', text: 'Use Defensive Cooldowns', default: true},
        {type: 'slider', uid: 'BalanceDruidBarkskinThreshold', text: 'Barkskin HP Threshold', default: 60, min: 1, max: 100},
        {type: 'slider', uid: 'BalanceDruidBearFormThreshold', text: 'Bear Form HP Threshold', default: 30, min: 1, max: 100},
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      common.waitForCastOrChannel(),

      // Interrupts (outside GCD)
      spell.interrupt('Solar Beam'),

      common.waitForTarget(),
      common.waitForFacing(),

      // Form management - can go directly from Bear to Moonkin, but respect Travel Form
      new bt.Selector(
        // Skip all combat actions if in travel form
        new bt.Decorator(
          ret => me.hasAura(auras.travelForm),
          new bt.Action(() => bt.Status.Success)
        ),
        // If in Bear Form and not in emergency situation, switch to Moonkin
        new bt.Decorator(
          ret => me.hasAura(auras.bearForm) &&
                 me.effectiveHealthPercent > Settings.BalanceDruidBearFormThreshold + 10,
          spell.cast("Moonkin Form")
        ),
        // If not in any form, go to Moonkin
        new bt.Decorator(
          req => !me.hasAura(auras.moonkinForm) && !me.hasAura(auras.bearForm) && !me.hasAura(auras.travelForm),
          spell.cast("Moonkin Form")
        )
      ),

      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          // Defensive cooldowns (highest priority)
          this.defensiveCooldowns(),

          // Dispels
          spell.dispel("Remove Corruption", true, DispelPriority.Low, false, WoWDispelType.Curse, WoWDispelType.Poison),

          // Burst damage when conditions are met
          new bt.Decorator(
            ret => Combat.burstToggle && me.target,
            this.burstDamage()
          ),

          // Multi-target rotation for 2+ enemies
          new bt.Decorator(
            ret => me.target && this.getEnemyCount() >= 2,
            this.multiTargetDamage()
          ),

          // Single target rotation
          this.singleTargetDamage()
        )
      )
    );
  }

  defensiveCooldowns() {
    return new bt.Selector(
      // Barkskin
      spell.cast('Barkskin', on => me, () =>
        me.effectiveHealthPercent <= Settings.BalanceDruidBarkskinThreshold &&
        Settings.BalanceDruidUseDefensiveCooldown),

      // Bear Form (emergency defensive)
      spell.cast('Bear Form', on => me, () =>
        me.effectiveHealthPercent <= Settings.BalanceDruidBearFormThreshold &&
        Settings.BalanceDruidUseDefensiveCooldown),

      // Renewal
      spell.cast('Renewal', on => me, () =>
        me.effectiveHealthPercent <= 50 &&
        Settings.BalanceDruidUseDefensiveCooldown)
    );
  }

  // Burst Damage Sequence
  burstDamage() {
    return new bt.Selector(
      // Use Warrior of Elune on cooldown
      spell.cast('Warrior of Elune', () => true),

      // Apply and maintain DOTs
      this.maintainDots(),

      // Use major cooldowns
      this.useCooldowns(),

      // Convoke the Spirits during Celestial Alignment with low Astral Power
      spell.cast('Convoke the Spirits', on => me.target, () =>
        (me.hasAura(auras.celestialAlignment) || me.hasAura(auras.incarnationChosenOfElune)) &&
        this.getAstralPower() < 40),

      // Fury of Elune if not entering Celestial Alignment
      spell.cast('Fury of Elune', on => me.target, () =>
        !spell.getCooldown('Celestial Alignment').ready),

      // Starfall for burst AoE or with procs
      spell.cast('Starfall', on => me.target, () =>
        me.hasAura(auras.starweaversWarp) ||
        me.hasAura(auras.touchTheCosmos) ||
        this.getAstralPower() >= 50),

      // Starsurge to spend Astral Power or maintain Starlord
      spell.cast('Starsurge', on => me.target, () =>
        this.getAstralPower() >= 40 ||
        (me.hasAura(auras.starlord) && me.getAuraStacks(auras.starlord) < 3)),

      // Fall back to sustained damage
      this.singleTargetDamage()
    );
  }

  // Single Target Damage (Elune's Chosen Priority)
  singleTargetDamage() {
    return new bt.Selector(
      // Use Warrior of Elune on cooldown (Lunar Calling talent) - only with burst toggle
      spell.cast('Warrior of Elune', () =>
        Combat.burstToggle && (this.hasTalent('Lunar Calling') || this.getEclipseRemaining() <= 7000)),

      // Apply and maintain DOTs
      this.maintainDots(),

      // Cast Starfall when we have enough Astral Power (early priority)
      spell.cast('Starfall', on => me.target, () =>
        this.getAstralPower() >= 30),

      // Cast Celestial Alignment if just cast Fury of Elune - only with burst toggle
      spell.cast('Celestial Alignment', () =>
        Combat.burstToggle &&
        Settings.BalanceDruidUseOffensiveCooldown &&
        !me.hasAura(auras.celestialAlignment) &&
        !me.hasAura(auras.incarnationChosenOfElune) &&
        spell.getCooldown('Fury of Elune').timeleft > 0),

      // Cast Convoke the Spirits during Celestial Alignment with low Astral Power - only with burst toggle
      spell.cast('Convoke the Spirits', on => me.target, () =>
        Combat.burstToggle &&
        (me.hasAura(auras.celestialAlignment) || me.hasAura(auras.incarnationChosenOfElune)) &&
        this.getAstralPower() < 40),

      // Cast two Wraths to enter Lunar Eclipse if not entering cooldowns
      spell.cast('Wrath', on => me.target, () =>
        !this.inEclipse() && !this.hasCooldownsReady()),

      // Cast Fury of Elune if not entering Celestial Alignment - only with burst toggle
      spell.cast('Fury of Elune', on => me.target, () =>
        Combat.burstToggle && !spell.getCooldown('Celestial Alignment').ready),

      // Cast Starfall if we have Starweaver's Warp proc or sufficient Astral Power
      spell.cast('Starfall', on => me.target, () =>
        me.hasAura(auras.starweaversWarp) ||
        me.hasAura(auras.touchTheCosmos) ||
        this.getAstralPower() >= 40),

      // Cast Starsurge to spend Astral Power or maintain Starlord
      spell.cast('Starsurge', on => me.target, () =>
        this.getAstralPower() >= 40 ||
        (me.hasAura(auras.starlord) && me.getAuraStacks(auras.starlord) < 3)),

      // Cast Starfire to generate Astral Power (inside Celestial Alignment due to Lunar Calling)
      spell.cast('Starfire', on => me.target, () =>
        this.hasTalent('Lunar Calling') || this.inLunarEclipse()),

      // Moon cycle abilities
      spell.cast('New Moon', on => me.target, () => me.hasAura(auras.newMoon)),
      spell.cast('Half Moon', on => me.target, () => me.hasAura(auras.halfMoon)),
      spell.cast('Full Moon', on => me.target, () => me.hasAura(auras.fullMoon)),

      // Wild Mushroom
      spell.cast('Wild Mushroom', on => me.target, () =>
        !this.getDebuffRemainingTime('Fungal Growth') > 2000),

      // Default filler - Wrath
      spell.cast('Wrath', on => me.target)
    );
  }

  // Multi-Target Damage (Elune's Chosen Multi-Target Priority)
  multiTargetDamage() {
    return new bt.Selector(
      // Use Warrior of Elune on cooldown - only with burst toggle
      spell.cast('Warrior of Elune', () => Combat.burstToggle),

      // Apply and maintain DOTs on multiple targets
      this.maintainMultiTargetDots(),

      // Cast Fury of Elune - only with burst toggle
      spell.cast('Fury of Elune', on => me.target, () => Combat.burstToggle),

      // Cast Celestial Alignment - only with burst toggle
      spell.cast('Celestial Alignment', () =>
        Combat.burstToggle &&
        Settings.BalanceDruidUseOffensiveCooldown &&
        !me.hasAura(auras.celestialAlignment) &&
        !me.hasAura(auras.incarnationChosenOfElune)),

      // Cast two Wraths to enter Lunar Eclipse if not entering cooldowns
      spell.cast('Wrath', on => me.target, () =>
        !this.inEclipse() && !this.hasCooldownsReady()),

      // Cast Starfall to spend Astral Power, maintain Starlord, or spend Touch the Cosmos
      spell.cast('Starfall', on => me.target, () =>
        this.getAstralPower() >= 50 ||
        (me.hasAura(auras.starlord) && me.getAuraStacks(auras.starlord) < 3) ||
        me.hasAura(auras.touchTheCosmos)),

      // Cast Starfire to generate Astral Power
      spell.cast('Starfire', on => me.target),

      // Default filler - Wrath
      spell.cast('Wrath', on => me.target)
    );
  }

  maintainDots() {
    return new bt.Selector(
      // Sunfire - apply if target will live ~5 seconds
      spell.cast('Sunfire', on => me.target, () =>
        !me.target.hasAuraByMe('Sunfire') ||
        this.getDebuffRemainingTime('Sunfire') < 5000),

      // Moonfire - apply if target will live ~6 seconds
      spell.cast('Moonfire', on => me.target, () =>
        !me.target.hasAuraByMe('Moonfire') ||
        this.getDebuffRemainingTime('Moonfire') < 6000),

      // Stellar Flare if talented
      spell.cast('Stellar Flare', on => me.target, () =>
        this.hasTalent('Stellar Flare') &&
        (!me.target.hasAuraByMe('Stellar Flare') ||
         this.getDebuffRemainingTime('Stellar Flare') < 7000))
    );
  }

  maintainMultiTargetDots() {
    return new bt.Selector(
      // Sunfire on current target
      spell.cast('Sunfire', on => me.target, () =>
        !me.target.hasAuraByMe('Sunfire') ||
        this.getDebuffRemainingTime('Sunfire') < 5000),

      // Moonfire on current target
      spell.cast('Moonfire', on => me.target, () =>
        !me.target.hasAuraByMe('Moonfire') ||
        this.getDebuffRemainingTime('Moonfire') < 6000)
    );
  }

  useCooldowns() {
    return new bt.Selector(
      // Celestial Alignment
      spell.cast('Celestial Alignment', () =>
        Settings.BalanceDruidUseOffensiveCooldown &&
        !me.hasAura(auras.celestialAlignment) &&
        !me.hasAura(auras.incarnationChosenOfElune)),

      // Incarnation: Chosen of Elune (if talented)
      spell.cast('Incarnation: Chosen of Elune', () =>
        Settings.BalanceDruidUseOffensiveCooldown &&
        this.hasTalent('Incarnation: Chosen of Elune') &&
        !me.hasAura(auras.celestialAlignment) &&
        !me.hasAura(auras.incarnationChosenOfElune))
    );
  }

  // Helper functions
  getAstralPower() {
    return me.powerByType(PowerType.LunarPower);
  }

  getEnemyCount() {
    return me.target ? me.target.getUnitsAroundCount(8) : 0;
  }

  inEclipse() {
    return me.hasAura(auras.solarEclipse) || me.hasAura(auras.lunarEclipse);
  }

  inLunarEclipse() {
    return me.hasAura(auras.lunarEclipse);
  }

  inSolarEclipse() {
    return me.hasAura(auras.solarEclipse);
  }

  getEclipseRemaining() {
    const solar = me.getAura(auras.solarEclipse);
    const lunar = me.getAura(auras.lunarEclipse);
    const solarRemaining = solar ? solar.remaining : 0;
    const lunarRemaining = lunar ? lunar.remaining : 0;
    return Math.max(solarRemaining, lunarRemaining);
  }

  hasCooldownsReady() {
    return spell.getCooldown('Celestial Alignment').ready ||
           spell.getCooldown('Incarnation: Chosen of Elune').ready;
  }

  hasTalent(talentName) {
    return me.hasAura(talentName);
  }

  getDebuffRemainingTime(debuffName) {
    if (!me.target) return 0;
    const debuff = me.target.getAuraByMe(debuffName);
    return debuff ? debuff.remaining : 0;
  }
}
