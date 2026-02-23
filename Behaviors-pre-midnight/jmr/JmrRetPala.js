import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import objMgr, { me } from "@/Core/ObjectManager";
import { defaultHealTargeting as h } from "@/Targeting/HealTargeting";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { DispelPriority } from "@/Data/Dispels"
import { WoWDispelType } from "@/Enums/Auras";
import spellBlacklist from "@/Data/PVPData";
import colors from "@/Enums/Colors";
import { PowerType } from "@/Enums/PowerType";
import Settings from "@/Core/Settings";

export class JMRRETPALA extends Behavior {
  name = "JMR Retribution Paladin";
  context = BehaviorContext.Any; // PVP or PVE
  specialization = Specialization.Paladin.Retribution;

  static settings = [
    {header: "Jmr Ret Settings"},
    {header: ""},
    {header: "Defensive Cooldowns"},
    // { type: "slider", uid: "JmrDSPercent", text: "Death Strike Health Percent", min: 0, max: 100, default: 75 },
    // { type: "slider", uid: "JmrRuneTapSetting", text: "Rune Tap Health Percent", min: 0, max: 100, default: 65 },
    // { type: "slider", uid: "JmrIBFSetting", text: "Icebound Fortitude Health Percent", min: 0, max: 100, default: 40 },
    // { type: "slider", uid: "JmrVBSetting", text: "Vampiric Blood Health Percent", min: 0, max: 100, default: 55 },
    // { type: "slider", uid: "JmrDeathStrikeDumpAmount", text: "Death Strike Dump Amount", min: 0, max: 100, default: 65 },
    // { type: "slider", uid: "JmrLichborneSetting", text: "Lichborne Health Percent", min: 0, max: 100, default: 50 },
    {header: ""},
    {header: "Offensive Cooldowns"},
    // { type: "slider", uid: "JmrDRWTTD", text: "Dancing Rune Weapon Time to Die", min: 0, max: 100, default: 10 },
    // { type: "checkbox", uid: "BloodDKUseSmackyHands", text: "Use Smacky Hands", default: true},
    // { type: "slider", uid: "JmrAbomTTD", text: "Abomination Limb Time to Die", min: 0, max: 100, default: 20 },
    {header: ""},
    {header: "Utility"},
    {type: "checkbox", uid: "testrotationenable", text: "Enable the test Rotation", default: false},
  ];

  static rotationEnabled = true;
  static hpgCount = 0;

  static initializeHPGTracking() {
    wow.EventListener.register(function (event) {
      var eventData = event.args[0];
      var eventType = eventData.eventType;
      var spellId = eventData.args[12];

      if (eventType === 6 && me.specialization === 66) {
        JMRRETPALA.hpgCount += 1;
      }

      if ((eventType === 7 || eventType === 8) && spellId === 385127) {
        JMRRETPALA.hpgCount = 0;
      }
    }, "COMBAT_LOG_EVENT_UNFILTERED");
  }

  static getHPGTo2Dawn() {
    if (!me.hasAura("Of Dusk and Dawn")) {
      return -1;
    }
    var blessingOfDawnStacks = me.getAuraStacks(385127) || 0;
    return 6 - JMRRETPALA.hpgCount - (blessingOfDawnStacks * 3);
  }

  build() {
    return new bt.Selector(
      new bt.Decorator(
        () => JMRRETPALA.rotationEnabled,
        new bt.Decorator(
          ret => !spell.isGlobalCooldown(),
          new bt.Selector(
            common.waitForNotMounted(),
            common.waitForNotSitting(),
            common.waitForTarget(),
            spell.cast("Devotion Aura", on => me, req => !me.hasVisibleAura(465)),
            spell.cast("Intercession",
              on => {
                const mouseoverGuid = wow.GameUI.mouseOverGuid;
                if (mouseoverGuid && !mouseoverGuid.isNull) {
                  return mouseoverGuid.toUnit();
                }
                return null;
              },
              req => {
                const mouseoverGuid = wow.GameUI.mouseOverGuid;
                return mouseoverGuid && this.mouseoverIsDeadFriend() && me.powerByType(PowerType.HolyPower) >= 3;
              }
            ),
            spell.interrupt("Rebuke"),
            spell.dispel("Cleanse Toxins", true, DispelPriority.Low, true, WoWDispelType.Poison, WoWDispelType.Disease),
            //spell.cast("Shield of Vengeance", on => me, req => me.inCombat() && me.getEnemies(15).length >= 1),
            // actions+=/call_action_list,name=cooldowns
            new bt.Decorator(
              ret => me.inCombat() && this.currentorbestTarget() !== undefined && this.currentorbestTarget() !== null,
              this.cooldowns()
            ),
            // actions+=/call_action_list,name=defensives
            new bt.Decorator(
              ret => me.inCombat() && this.currentorbestTarget() !== undefined && this.currentorbestTarget() !== null && this.currentorbestTarget().distanceTo(me) < 15,
              this.defensives()
            ),
            // actions+=/call_action_list,name=trinkets
            new bt.Decorator(
              ret => me.inCombat() && this.currentorbestTarget() !== undefined && this.currentorbestTarget() !== null && this.currentorbestTarget().distanceTo(me) < 15 && (me.hasVisibleAura(454373) || me.hasVisibleAura(454351)),
              this.trinkets()
            ),
            // actions+=/call_action_list,name=standard
            new bt.Decorator(
              ret => me.inCombat() && this.currentorbestTarget() !== undefined && this.currentorbestTarget() !== null && Settings.testrotationenable,
              new bt.Selector(
                this.testrotation(),
              )
            ),
            new bt.Decorator(
              ret => me.inCombat() && this.currentorbestTarget() !== undefined && this.currentorbestTarget() !== null && !Settings.testrotationenable,
              new bt.Selector(
                this.generators(),
              )
            ),
          )
        )
      ),
    );
  }

  cooldowns() {
    return new bt.Selector(
      // Modified Shield of Vengeance logic for M+ only with Blessing of Sacrifice check
      spell.cast("Shield of Vengeance",
        on => me,
        req => me.inMythicPlus() &&
          combat.burstToggle &&
          me.getEnemies(15).length >= 1 &&
          spell.getCooldown(6940).timeleft < 1000
      ),
      // New Blessing of Sacrifice logic to cast on tank when Shield of Vengeance is up in M+
      spell.cast("Blessing of Sacrifice",
        on => this.getMythicPlusTank(),
        req => me.inMythicPlus() &&
          combat.burstToggle &&
          me.hasVisibleAura("Shield of Vengeance") &&
          this.getMythicPlusTank() !== null
      ),
      // Rest of cooldowns remain unchanged
      spell.cast("Execution Sentence",
        on => this.currentorbestTarget(),
        req => (me.hasAura("Radiant Glory")) &&
          (me.powerByType(PowerType.HolyPower) >= 4 ||
            me.powerByType(PowerType.HolyPower) >= 3 ||
            me.powerByType(PowerType.HolyPower) >= 2 &&
            (me.hasAura("Divine Auxiliary") || me.hasAura("Radiant Glory"))) &&
          (spell.getCooldown(255937).timeleft < 1500 && spell.getCharges(255937) === 1)
      ),
      spell.cast("Hammer of Light", on => this.currentorbestTarget()),
      spell.cast("Crusade",
        on => me,
        req => me.powerByType(PowerType.HolyPower) >= 5 ||
          me.powerByType(PowerType.HolyPower) >= 3
      ),
      spell.cast("Final Reckoning",
        on => this.currentorbestTarget(),
        req => (me.powerByType(PowerType.HolyPower) >= 4 ||
            me.powerByType(PowerType.HolyPower) >= 3 ||
            me.powerByType(PowerType.HolyPower) >= 2 &&
            (me.hasAura("Divine Auxiliary") || me.hasAura("Radiant Glory"))) &&
          (me.hasAura("Radiant Glory") &&
            (me.hasAura(454373) || me.hasAura("Crusade") &&
              spell.getCooldown("Wake of Ashes").timeleft < 1.5))
      ),
    );
  }

  // Helper method to get the current tank in M+
  getMythicPlusTank() {
    if (!me.inMythicPlus()) return null;

    // Get all tanks from the party
    const tanks = h.friends.Tanks;
    if (!tanks || tanks.length === 0) return null;

    // Return the first active tank that's not dead
    return tanks.find(tank =>
      tank &&
      !tank.deadOrGhost &&
      tank.distanceTo(me) <= 40 &&
      me.withinLineOfSight(tank)
    ) || null;
  }

  defensives() {
    return new bt.Selector(
      spell.cast("Shield of Vengeance", on => me, req => me.effectiveHealthPercent < 30),
      spell.cast("Lay on Hands", on => me, req => me.effectiveHealthPercent < 10),
      spell.cast("Divine Shield", on => me, req => me.effectiveHealthPercent < 25),
      spell.cast("Word of Glory", on => me, req => me.effectiveHealthPercent < 25),
    );
  }

  trinkets() {
    return new bt.Selector(
      common.useEquippedItemByName("Mark of Khardros"),
    );
  }

  testrotation() {
    return new bt.Selector(
      spell.cast("Execution Sentence", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && ((spell.getCooldown(255937).timeleft < 1500 || spell.getCooldown(255937).ready) && spell.getCharges(255937) === 1)),
      spell.cast("Wake of Ashes", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && !me.hasVisibleAura(454373)),
      spell.cast("Divine Storm", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.hasVisibleAura(326733)),
      spell.cast("Divine Storm", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.getEnemies(8).length > 1 && me.powerByType(PowerType.HolyPower) > 4),
      spell.cast("Final Verdict", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.getEnemies(8).length === 1 && me.powerByType(PowerType.HolyPower) > 4),
      spell.cast("Blade of Justice", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.inCombatWith(me.targetUnit) && me.getEnemies(8).length === 1 && !me.targetUnit.hasVisibleAuraByMe(383346)),
      spell.cast("Wake of Ashes", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined)),
      spell.cast("Divine Toll", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined)),
      spell.cast("Blade of Justice", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.getEnemies(8).length > 1),
      spell.cast("Hammer of Wrath", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && this.currentorbestTarget().pctHealth <= 35 && me.getEnemies(8).length === 1),
      spell.cast("Judgment", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.powerByType(PowerType.HolyPower) <= 3),
      spell.cast("Blade of Justice", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.getEnemies(8).length === 1),
      spell.cast("Hammer of Wrath", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && (this.currentorbestTarget().pctHealth <= 20 || (me.powerByType(PowerType.HolyPower) <= 4 && me.getEnemies(8).length === 1) || (me.powerByType(PowerType.HolyPower) <= 3 && me.getEnemies(8).length > 1))),
      spell.cast("Final Verdict", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.getEnemies(8).length === 1),
      spell.cast("Divine Storm", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.getEnemies(8).length > 1),
    );
  }

  generators() {
    return new bt.Selector(
      new bt.Decorator(
        ret => me.getEnemies(8).length >= 1 && me.powerByType(PowerType.HolyPower) >= 5 || me.powerByType(PowerType.HolyPower) >= 4 && me.hasVisibleAura(384029),
        this.finishers()
      ),
      // actions.generators+=/templar_slash,if=buff.templar_strikes.remains<gcd*2
      spell.cast("Templar's Slash", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.hasVisibleAura(406647) && me.getAura(406647).remaining < 3),
      // actions.generators+=/blade_of_justice,if=!dot.expurgation.ticking&talent.holy_flames
      spell.cast("Blade of Justice", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && !me.targetUnit.hasAura(383346) && me.hasAura("Holy Flames")),
      // actions.generators+=/wake_of_ashes,if=(!talent.lights_guidance|holy_power>=2&talent.lights_guidance)&(cooldown.avenging_wrath.remains>6|cooldown.crusade.remains>6|talent.radiant_glory)&(!talent.execution_sentence|cooldown.execution_sentence.remains>4|target.time_to_die<8)&(!raid_event.adds.exists|raid_event.adds.in>10|raid_event.adds.up)
      spell.cast("Wake of Ashes", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && (!me.hasAura(427445) || me.powerByType(PowerType.HolyPower) >= 2 && me.hasAura(427445)) && (me.hasAura("Radiant Glory")) && (!me.hasAura("Execution Sentence") || spell.getCooldown("Execution Sentence").timeleft > 4 || this.currentorbestTarget().timeToDeath() < 8)),
      // actions.generators+=/divine_toll,if=holy_power<=2&(!raid_event.adds.exists|raid_event.adds.in>10|raid_event.adds.up)&(cooldown.avenging_wrath.remains>15|cooldown.crusade.remains>15|talent.radiant_glory|fight_remains<8)
      spell.cast("Divine Toll", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.powerByType(PowerType.HolyPower) <= 2),
      // actions.generators+=/call_action_list,name=finishers,if=holy_power>=3&buff.crusade.up&buff.crusade.stack<10
      new bt.Decorator(
        ret => me.getEnemies(8).length >= 1 && me.powerByType(PowerType.HolyPower) >= 3 && me.hasVisibleAura(454373) && me.getAuraStacks(454373) < 10,
        this.finishers()
      ),
      // actions.generators+=/templar_slash,if=buff.templar_strikes.remains<gcd&spell_targets.divine_storm>=2
      spell.cast("Templar's Slash", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.hasVisibleAura(406647) && me.getAura(406647).remaining < 1.5 && me.getEnemies(8).length >= 2),
      // actions.generators+=/blade_of_justice,if=(holy_power<=3|!talent.holy_blade)&(spell_targets.divine_storm>=2&talent.blade_of_vengeance)
      spell.cast("Blade of Justice", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && (me.getEnemies(8).length >= 2 && me.hasAura("Blade of Vengeance"))),
      spell.cast("Hammer of Wrath", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.powerByType(PowerType.HolyPower) <= 3 && me.getEnemies(8).length < 2),
      // actions.generators+=/hammer_of_wrath,if=(spell_targets.divine_storm<2|!talent.blessed_champion)&(holy_power<=3|target.health.pct>20|!talent.vanguards_momentum)&(target.health.pct<35&talent.vengeful_wrath|buff.blessing_of_anshe.up)
      spell.cast("Hammer of Wrath", on => this.getHammerOfWrathTarget(), req => this.getHammerOfWrathTarget() !== undefined && (me.getEnemies(8).length < 2 || !me.hasAura("Blessed Champion")) && (me.powerByType(PowerType.HolyPower) <= 3 || this.getHammerOfWrathTarget().effectiveHealthPercent > 20 || !me.hasAura("Vanguard's Momentum")) && (this.getHammerOfWrathTarget().effectiveHealthPercent < 35 && me.hasAura("Vengeful Wrath") || me.hasAura("Blessing of An'she"))),
      // actions.generators+=/templar_strike
      spell.cast("Templar's Strike", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined)),
      // actions.generators+=/judgment,if=holy_power<=3|!talent.boundless_judgment
      spell.cast("Judgment", on => this.getLowestRemainsJudgment(), req => this.getLowestRemainsJudgment() !== undefined && (me.powerByType(PowerType.HolyPower) <= 3 || !me.hasAura("Boundless Judgment"))),
      // actions.generators+=/blade_of_justice,if=holy_power<=3|!talent.holy_blade
      spell.cast("Blade of Justice", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined)),
      // actions.generators+=/hammer_of_wrath,if=(spell_targets.divine_storm<2|!talent.blessed_champion)&(holy_power<=3|target.health.pct>20|!talent.vanguards_momentum)
      spell.cast("Hammer of Wrath", on => this.getHammerOfWrathTarget(), req => this.getHammerOfWrathTarget() !== undefined && (me.getEnemies(8).length < 2 || !me.hasAura("Blessed Champion")) && (me.powerByType(PowerType.HolyPower) <= 3 || this.getHammerOfWrathTarget().effectiveHealthPercent > 20 || !me.hasAura("Vanguard's Momentum"))),
      // actions.generators+=/templar_slash
      spell.cast("Templar's Slash", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined)),
      // actions.generators+=/call_action_list,name=finishers,if=(target.health.pct<=20|buff.avenging_wrath.up|buff.crusade.up|buff.empyrean_power.up)
      new bt.Decorator(
        ret => this.currentorbestTarget() !== (null || undefined) && (me.targetUnit.pctHealth <= 20 || me.hasVisibleAura(454373) || me.hasVisibleAura(454351) || me.hasVisibleAura(326733)),
        this.finishers()
      ),
      // actions.generators+=/crusader_strike,if=cooldown.crusader_strike.charges_fractional>=1.75&(holy_power<=2|holy_power<=3&cooldown.blade_of_justice.remains>gcd*2|holy_power=4&cooldown.blade_of_justice.remains>gcd*2&cooldown.judgment.remains>gcd*2)
      spell.cast("Crusader Strike", on => this.currentorbestTarget(), req => spell.getCharges("Crusader Strike") >= 1.75 && (me.powerByType(PowerType.HolyPower) <= 2 || me.powerByType(PowerType.HolyPower) <= 3 && spell.getCooldown("Blade of Justice").timeleft > 3 || me.powerByType(PowerType.HolyPower) === 4 && spell.getCooldown("Blade of Justice").timeleft > 3 && spell.getCooldown("Judgment").timeleft > 3)),
      // actions.generators+=/call_action_list,name=finishers
      new bt.Decorator(
        ret => this.currentorbestTarget() !== (null || undefined),
        this.finishers()
      ),
      spell.cast("Hammer of Wrath", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.powerByType(PowerType.HolyPower) <= 3 && me.hasVisibleAura(383329)),
      // actions.generators+=/hammer_of_wrath,if=holy_power<=3|target.health.pct>20|!talent.vanguards_momentum
      spell.cast("Hammer of Wrath", on => this.getHammerOfWrathTarget(), req => this.getHammerOfWrathTarget() !== undefined && (me.powerByType(PowerType.HolyPower) <= 3 || this.getHammerOfWrathTarget().effectiveHealthPercent > 20 || !me.hasAura("Vanguard's Momentum"))),
      // actions.generators+=/crusader_strike
      spell.cast("Crusader Strike", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined)),
      // actions.generators+=/arcane_torrent
      spell.cast("Arcane Torrent", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined)),
    );
  }

  finishers() {
    return new bt.Selector(
      spell.cast("Wake of Ashes", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && this.currentorbestTarget().hasAuraByMe(343527)),
      //actions.finishers=variable,name=ds_castable,value=(spell_targets.divine_storm>=2|buff.empyrean_power.up|!talent.final_verdict&talent.tempest_of_the_lightbringer)&!buff.empyrean_legacy.up&!(buff.divine_arbiter.up&buff.divine_arbiter.stack>24)
      // actions.finishers+=/hammer_of_light
      spell.cast("Hammer of Light", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined)),
      // actions.finishers+=/divine_hammer,if=holy_power=5
      spell.cast("Divine Hammer", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.powerByType(PowerType.HolyPower) === 5),
      spell.cast("Final Verdict", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.getEnemies(8).length === 1 && !me.hasVisibleAura(326733) && (me.hasVisibleAura(454373) && me.getAuraStacks(454373) < 10 || me.hasAura("Radiant Glory")) && !spell.canCast(427453, me.targetUnit) && (!me.hasVisibleAura(198137) || spell.getCooldown("Divine Hammer").timeleft > 110 && me.powerByType(PowerType.HolyPower) >= 4)),
      // actions.finishers+=/divine_storm,if=variable.ds_castable&!buff.hammer_of_light_ready.up&(!talent.crusade|cooldown.crusade.remains>gcd*3|buff.crusade.up&buff.crusade.stack<10|talent.radiant_glory)&(!buff.divine_hammer.up|cooldown.divine_hammer.remains>110&holy_power>=4)
      spell.cast("Divine Storm", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && me.isFacing(me.targetUnit, 75) && (!spell.canCast(427453, me.targetUnit) && (me.getEnemies(8).length >= 2 || me.hasVisibleAura(326733) || !me.hasAura(383328) && me.hasAura(383396))) && (me.hasVisibleAura(454373) && me.getAuraStacks(454373) < 10 || me.hasAura("Radiant Glory")) && (!me.hasVisibleAura(198137) || spell.getCooldown("Divine Hammer").timeleft > 110 && me.powerByType(PowerType.HolyPower) >= 4)),
      // actions.finishers+=/justicars_vengeance,if=(!talent.crusade|cooldown.crusade.remains>gcd*3|buff.crusade.up&buff.crusade.stack<10|talent.radiant_glory)&!buff.hammer_of_light_ready.up&(!buff.divine_hammer.up|cooldown.divine_hammer.remains>110&holy_power>=4)
      spell.cast("Justicar's Vengeance", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && (me.hasVisibleAura(454373) && me.getAuraStacks(454373) < 10 || me.hasAura("Radiant Glory")) && !spell.canCast(427453, me.targetUnit) && (!me.hasVisibleAura(198137) || spell.getCooldown("Divine Hammer").timeleft > 110 && me.powerByType(PowerType.HolyPower) >= 4)),
      // actions.finishers+=/templars_verdict,if=(!talent.crusade|cooldown.crusade.remains>gcd*3|buff.crusade.up&buff.crusade.stack<10|talent.radiant_glory)&!buff.hammer_of_light_ready.up&(!buff.divine_hammer.up|cooldown.divine_hammer.remains>110&holy_power>=4)
      spell.cast("Final Verdict", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== (null || undefined) && (me.hasVisibleAura(454373) && me.getAuraStacks(454373) < 10 || me.hasAura("Radiant Glory")) && !spell.canCast(427453, me.targetUnit) && (!me.hasVisibleAura(198137) || spell.getCooldown("Divine Hammer").timeleft > 110 && me.powerByType(PowerType.HolyPower) >= 4)),
    );
  }

  ds_castable() {
    return ((me.getEnemies(8).length >= 2 || me.hasVisibleAura(326733) || !me.hasAura(383328) && me.hasAura(383396)) && !spell.canCast(427453, me.targetUnit));
  }

  getLowestRemainsJudgment() {
    const enemies = me.getEnemies(30);

    // If we have 2 or more enemies and current target has Judgment
    if (enemies.length >= 2 && me.target && me.target.hasAuraByMe(197277)) {
      // Look for a unit without Judgment
      for (const enemy of enemies) {
        if (me.inCombatWith(enemy) && !enemy.hasAuraByMe(197277)) {
          return enemy;
        }
      }
    }

    if (me.target) {
      return me.target;
    }
  }

  currentorbestTarget() {
    const target = me.target;

    // If a valid target exists, return it
    if (target !== null && me.canAttack(target)) {
      return target;
    }

    // If target is undefined, find the closest valid enemy
    if (target === undefined) {
      const enemies = me.getEnemies(30)
        .filter(unit =>
          me.canAttack(unit) &&
          common.validTarget(unit) &&
          me.withinLineOfSight(unit) &&
          !unit.isImmune() &&
          me.inCombatWith(unit)
        )
        .sort((a, b) => me.distanceTo(a) - me.distanceTo(b)); // Sort enemies by distance

      // Return the closest enemy if any are valid
      return enemies.length > 0 ? enemies[0] : null;
    }

    // If no target is set, return the combat's best target
    if (target === null) {
      return combat.bestTarget;
    }
  }


  getHammerOfWrathTarget() {
    const enemies = me.getEnemies();

    for (const enemy of enemies) {
      if (enemy.effectiveHealthPercent < 20 && enemy.inCombatWithMe) {
        return enemy;
      }
    }

    return undefined
  }

  mouseoverIsDeadFriend() {
    const mouseoverGuid = wow.GameUI.mouseOverGuid;
    if (mouseoverGuid && !mouseoverGuid.isNull) {
      const mouseover = mouseoverGuid.toUnit();
      if (mouseover) {
        return mouseover.deadOrGhost &&
          mouseover.inMyGroup() &&
          mouseover.guid !== me.guid &&
          me.withinLineOfSight(mouseover);
      }
    }
    return false;
  }

  getCurrentTarget() {
    const targetPredicate = unit =>
      unit && common.validTarget(unit) &&
      unit.distanceTo(me) <= 30 &&
      me.withinLineOfSight(unit) &&
      !unit.isImmune();

    // First, look for a unit with the Schism aura
    const schismTarget = combat.targets.find(unit => unit.hasAura("Judgement") && targetPredicate(unit));
    if (schismTarget) {
      return schismTarget;
    }

    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    const enemies = me.getEnemies();

    for (const enemy of enemies) {
      if (enemy.inCombatWithMe) {
        return enemy;
      }
    }
  }

  // todo - probably move this somewhere useful rather than here?
  isNotDeadAndInLineOfSight(friend) {
    return friend && !friend.deadOrGhost && me.withinLineOfSight(friend);
  }

  getEnemiesInRange(range) {
    return combat.targets.filter(unit => me.distanceTo(unit) < range).length;
  }

  toggleRotation() {
    JMRRETPALA.rotationEnabled = !JMRRETPALA.rotationEnabled;
    console.info(`Rotation ${JMRRETPALA.rotationEnabled ? 'enabled' : 'disabled'}`);
  }

  renderRotationState() {
    if (!JMRRETPALA.rotationEnabled) {
      const drawList = imgui.getBackgroundDrawList();
      if (!drawList) return;

      const playerPos = me.position;
      const screenPos = wow.WorldFrame.getScreenCoordinates(playerPos);

      if (screenPos) {
        drawList.addText("OFF", {x: screenPos.x, y: screenPos.y - 20}, colors.red);
      }
    }
  }

}

