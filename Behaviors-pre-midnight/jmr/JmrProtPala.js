import {Behavior, BehaviorContext} from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import objMgr, { me } from "@/Core/ObjectManager";
import {defaultHealTargeting as h} from "@/Targeting/HealTargeting";
import {defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import {DispelPriority} from "@/Data/Dispels"
import {WoWDispelType} from "@/Enums/Auras";
import spellBlacklist from "@/Data/PVPData";
import colors from "@/Enums/Colors";
import {PowerType} from "@/Enums/PowerType";

export class JMRPROTECTIONPALA extends Behavior {
  name = "JMR Protection Paladin";
  context = BehaviorContext.Any; // PVP or PVE
  specialization = Specialization.Paladin.Protection;

  static rotationEnabled = true;
  static hpgCount = 0;

  static initializeHPGTracking() {
    wow.EventListener.register(function(event) {
      var eventData = event.args[0];
      var eventType = eventData.eventType;
      var spellId = eventData.args[12];

      if (eventType === 6 && me.specialization === 66) {
        JMRPROTECTIONPALA.hpgCount += 1;
      }

      if ((eventType === 7 || eventType === 8) && spellId === 385127) {
        JMRPROTECTIONPALA.hpgCount = 0;
      }
    }, "COMBAT_LOG_EVENT_UNFILTERED");
  }

  static getHPGTo2Dawn() {
    if (!me.hasAura("Of Dusk and Dawn")) {
      return -1;
    }
    var blessingOfDawnStacks = me.getAuraStacks(385127) || 0;
    return 6 - JMRPROTECTIONPALA.hpgCount - (blessingOfDawnStacks * 3);
  }

  build() {
    return new bt.Selector(
      new bt.Action(() => {
        if (imgui.isKeyPressed(imgui.Key.Z)) {
          this.toggleRotation();
        }
        return bt.Status.Failure;
      }),
      new bt.Decorator(
        () => JMRPROTECTIONPALA.rotationEnabled,
        new bt.Decorator(
          ret => !spell.isGlobalCooldown(),
          new bt.Selector(
            common.waitForNotMounted(),
            common.waitForNotSitting(),
            common.waitForCastOrChannel(),
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
            spell.cast("Avenger's Shield", on => combat.targets
              .filter(unit => unit.isCastingOrChanneling && unit.isInterruptible && me.isFacing(unit))
              .sort((a, b) => b.distanceTo(me) - a.distanceTo(me))[0]),
            spell.dispel("Cleanse Toxins", true, DispelPriority.Low, true, WoWDispelType.Poison, WoWDispelType.Disease),
            spell.cast("Hand of Reckoning", on => combat.targets.find(unit => unit.inCombat && unit.target && !unit.isTanking())),
            // actions+=/call_action_list,name=cooldowns
            new bt.Decorator(
              ret => me.inCombat() && this.currentorbestTarget() !== null && this.currentorbestTarget().distanceTo(me) < 15,
              this.cooldowns()
            ),
            // actions+=/call_action_list,name=defensives
            new bt.Decorator(
              ret => me.inCombat() && this.currentorbestTarget() !== null && this.currentorbestTarget().distanceTo(me) < 15,
              this.defensives()
            ),
            // actions+=/call_action_list,name=trinkets
            new bt.Decorator(
              ret => me.inCombat() && this.currentorbestTarget() !== null && this.currentorbestTarget().distanceTo(me) < 15,
              this.trinkets()
            ),
            // actions+=/call_action_list,name=standard
            common.waitForTarget(),
            new bt.Decorator(
              ret => me.inCombat() && this.currentorbestTarget() !== null && this.currentorbestTarget().distanceTo(me) < 15,
              new bt.Selector(
                this.standard(),
              )
            ),
          )
        )
      ),
      new bt.Action(() => {
        this.renderRotationState();
        return bt.Status.Failure;
      })
    );
  }

  cooldowns() {
    return new bt.Selector(
      // actions.cooldowns=lights_judgment,if=spell_targets.lights_judgment>=2|!raid_event.adds.exists|raid_event.adds.in>75|raid_event.adds.up
      spell.cast("Light's Judgment", on => this.currentorbestTarget(), req => me.getEnemies(10).length >= 2),
      // actions.cooldowns+=/avenging_wrath
      spell.cast("Avenging Wrath", on => me, req => me.inCombat()),
      // actions.cooldowns+=/moment_of_glory,if=(buff.avenging_wrath.remains<15|(time>10))
      spell.cast("Moment of Glory", on => me, req => me.hasVisibleAura(31884) && (me.getAuraByMe(31884).remaining < 15000)),
      // actions.cooldowns+=/divine_toll,if=spell_targets.shield_of_the_righteous>=3
      spell.cast("Divine Toll", on => this.currentorbestTarget(), req => me.getEnemies(12).length >= 3),
      // actions.cooldowns+=/bastion_of_light,if=buff.avenging_wrath.up|cooldown.avenging_wrath.remains<=30
      spell.cast("Bastion of Light", on => me, req => me.hasVisibleAura(31884) || spell.getCooldown("Avenging Wrath").timeleft <= 30),
    );
  }

  defensives() {
    return new bt.Selector(
      //actions.defensives=ardent_defender
      spell.cast("Ardent Defender", on => me, req => me.effectiveHealthPercent < 20),
      spell.cast("Guardian of Ancient Kings", on => me, req => me.effectiveHealthPercent < 30),
      spell.cast("Lay on Hands", on => me, req => me.effectiveHealthPercent < 10),
      spell.cast("Divine Shield", on => me, req => me.effectiveHealthPercent < 10),
      spell.cast("Word of Glory", on => me, req => me.effectiveHealthPercent < 50),
    );
  }

  trinkets() {
    return new bt.Selector(
      common.useEquippedItemByName("Mark of Khardros"),
    );
  }

  standard() {
    return new bt.Selector(
      spell.cast("Word of Glory", on => h.getPriorityTarget(), req => me.hasVisibleAura(327510) && (!me.hasVisibleAura(379041) || me.getAura(379041).remaining < 1500)),
      spell.cast("Consecration", on => me, req => !me.hasVisibleAura(188370)),
      // actions.standard=judgment,target_if=charges>=2|full_recharge_time<=gcd.max
      spell.cast("Judgment", on => this.getLowestRemainsJudgment(), req => !this.getLowestRemainsJudgment() === null && spell.getCharges("Judgment") >= 2),
      spell.cast("Avenger's Shield", on => this.currentorbestTarget(), req => me.hasAura(385726) && !me.hasVisibleAura(385724)),
      // actions.standard+=/hammer_of_light,if=buff.hammer_of_light_free.remains<2|buff.shake_the_heavens.remains<1|!buff.shake_the_heavens.up|cooldown.eye_of_tyr.remains<1.5|fight_remains<2
      spell.cast("Hammer of Light", on => this.currentorbestTarget(), req => this.currentorbestTarget() !== null && (me.hasVisibleAura(427441) && me.getAura(427441).remaining < 2000 || (me.hasVisibleAura(431533) && me.getAura(431533).remaining < 1000) || !me.hasVisibleAura(431533) || spell.getCooldown("Eye of Tyr").timeleft < 1500)),
      // actions.standard+=/eye_of_tyr,if=(hpg_to_2dawn=5|!talent.of_dusk_and_dawn.enabled)&talent.lights_guidance.enabled
      spell.cast("Eye of Tyr", on => this.currentorbestTarget(), req => (JMRPROTECTIONPALA.getHPGTo2Dawn() === 5 || !me.hasAura(409441)) && me.hasAura(427445)),
      // actions.standard+=/eye_of_tyr,if=(hpg_to_2dawn=1|buff.blessing_of_dawn.stack>0)&talent.lights_guidance.enabled
      spell.cast("Eye of Tyr", on => this.currentorbestTarget(), req => (JMRPROTECTIONPALA.getHPGTo2Dawn() === 1 || (me.getAuraStacks(385127) > 0 || me.hasVisibleAura(385127))) && me.hasAura(427445)),
      spell.cast("Word of Glory", on => me, req => me.powerByType(PowerType.HolyPower) >= 3 && (!me.hasVisibleAura(379041) || me.getAura(379041).remaining < 1500) && me.effectiveHealthPercent < 65),
      // actions.standard+=/shield_of_the_righteous,if=(!talent.righteous_protector.enabled|cooldown.righteous_protector_icd.remains=0)&!buff.hammer_of_light_ready.up
      spell.cast("Shield of the Righteous", on => me, req => true),
      // actions.standard+=/judgment,target_if=min:debuff.judgment.remains,if=spell_targets.shield_of_the_righteous>3&buff.bulwark_of_righteous_fury.stack>=3&holy_power<3
      spell.cast("Judgment", on => this.getLowestRemainsJudgment(), req => me.getEnemies(8).length > 3 && me.getAuraStacks(386652) >= 3 && me.powerByType(PowerType.HolyPower) < 3),
      // actions.standard+=/avengers_shield,if=!buff.bulwark_of_righteous_fury.up&talent.bulwark_of_righteous_fury.enabled&spell_targets.shield_of_the_righteous>=3
      spell.cast("Avenger's Shield", on => this.currentorbestTarget(), req => !me.hasVisibleAura(386652) && me.hasAura(386653) && me.getEnemies(8).length >= 3),
      // actions.standard+=/hammer_of_the_righteous,if=buff.blessed_assurance.up&spell_targets.shield_of_the_righteous<3&!buff.avenging_wrath.up
      spell.cast("Hammer of the Righteous", on => this.currentorbestTarget(), req => me.hasVisibleAura("Blessed Assurance") && me.getEnemies(8).length < 3 && !me.hasVisibleAura(31884)),
      // actions.standard+=/blessed_hammer,if=buff.blessed_assurance.up&spell_targets.shield_of_the_righteous<3&!buff.avenging_wrath.up
      spell.cast("Blessed Hammer", on => me, req => me.hasVisibleAura("Blessed Assurance") && me.getEnemies(8).length < 3 && !me.hasVisibleAura(31884)),
      // actions.standard+=/crusader_strike,if=buff.blessed_assurance.up&spell_targets.shield_of_the_righteous<2&!buff.avenging_wrath.up
      spell.cast("Crusader Strike", on => this.currentorbestTarget(), req => me.hasVisibleAura("Blessed Assurance") && me.getEnemies(8).length < 2 && !me.hasVisibleAura(31884)),
      // actions.standard+=/judgment,target_if=min:debuff.judgment.remains,if=charges>=2|full_recharge_time<=gcd.max
      spell.cast("Judgment", on => this.getLowestRemainsJudgment(), req => this.getLowestRemainsJudgment() !== null && spell.getCharges("Judgment") >= 2),
      // actions.standard+=/consecration,if=buff.divine_guidance.stack=5
      spell.cast("Consecration", on => me, req => me.getAuraStacks(433106) === 5),
      // actions.standard+=/holy_armaments,if=next_armament=sacred_weapon&(!buff.sacred_weapon.up|(buff.sacred_weapon.remains<6&!buff.avenging_wrath.up&cooldown.avenging_wrath.remains<=30)) 432459 432496 432472 432502
      spell.cast("Holy Bulwark", on => me, req => !me.hasVisibleAura(432502) || (me.getAuraByMe(432502).remaining < 6000 && !me.hasVisibleAura(31884) && spell.getCooldown("Avenging Wrath").timeleft <= 30)),
      // actions.standard+=/hammer_of_wrath
      spell.cast("Hammer of Wrath", on => this.currentorbestTarget(), req => true),
      spell.cast("Hammer of Wrath", on => this.getHammerOfWrathTarget(), req => this.getHammerOfWrathTarget() !== undefined),
      // actions.standard+=/divine_toll,if=(!raid_event.adds.exists|raid_event.adds.in>10)
      spell.cast("Divine Toll", on => this.currentorbestTarget(), req => this.currentorbestTarget().timeToDeath() > 20),
      // actions.standard+=/avengers_shield,if=talent.refining_fire.enabled&talent.lights_guidance.enabled
      spell.cast("Avenger's Shield", on => this.currentorbestTarget(), req => me.hasAura(469883) && me.hasAura(427445)),
      // actions.standard+=/judgment,target_if=min:debuff.judgment.remains,if=(buff.avenging_wrath.up&talent.hammer_and_anvil.enabled)
      spell.cast("Judgment", on => this.getLowestRemainsJudgment(), req => me.hasVisibleAura(31884) && me.hasAura(433718)),
      // actions.standard+=/holy_armaments,if=next_armament=holy_bulwark&charges=2
      spell.cast("Sacred Weapon", on => me, req => spell.getCharges("Sacred Weapon") === 2 && !me.hasVisibleAura(432502)),
      // actions.standard+=/judgment,target_if=min:debuff.judgment.remains
      spell.cast("Judgment", on => this.getLowestRemainsJudgment(), req => this.getLowestRemainsJudgment() !== null),
      // actions.standard+=/avengers_shield,if=!buff.shake_the_heavens.up&talent.shake_the_heavens.enabled
      spell.cast("Avenger's Shield", on => this.currentorbestTarget(), req => !me.hasVisibleAura(431533) && me.hasAura(431532)),
      // actions.standard+=/hammer_of_the_righteous,if=(buff.blessed_assurance.up&spell_targets.shield_of_the_righteous<3)|buff.shake_the_heavens.up
      spell.cast("Hammer of the Righteous", on => this.currentorbestTarget(), req => (me.hasVisibleAura("Blessed Assurance") && me.getEnemies(8).length < 3) || me.hasVisibleAura(431533)),
      // actions.standard+=/blessed_hammer,if=(buff.blessed_assurance.up&spell_targets.shield_of_the_righteous<3)|buff.shake_the_heavens.up
      spell.cast("Blessed Hammer", on => me, req => (me.hasVisibleAura("Blessed Assurance") && me.getEnemies(8).length < 3) || me.hasVisibleAura(431533)),
      // actions.standard+=/crusader_strike,if=(buff.blessed_assurance.up&spell_targets.shield_of_the_righteous<2)|buff.shake_the_heavens.up
      spell.cast("Crusader Strike", on => this.currentorbestTarget(), req => (me.hasVisibleAura("Blessed Assurance") && me.getEnemies(8).length < 2) || me.hasVisibleAura(431533)),
      // actions.standard+=/avengers_shield,if=!talent.lights_guidance.enabled
      spell.cast("Avenger's Shield", on => this.currentorbestTarget(), req => !me.hasAura(427445)),
      // actions.standard+=/consecration,if=!consecration.up
      spell.cast("Consecration", on => me, req => !me.hasVisibleAura(188370)),
      // actions.standard+=/eye_of_tyr,if=(talent.inmost_light.enabled&raid_event.adds.in>=45|spell_targets.shield_of_the_righteous>=3)&!talent.lights_deliverance.enabled
      spell.cast("Eye of Tyr", on => this.currentorbestTarget(), req => (me.hasAura(405757) || me.getEnemies(8).length >= 3) && !me.hasAura(425518)),
      // actions.standard+=/holy_armaments,if=next_armament=holy_bulwark
      spell.cast("Sacred Weapon", on => me, req => !me.hasVisibleAura(432502)),
      // actions.standard+=/blessed_hammer
      spell.cast("Blessed Hammer", on => me, req => true),
      // actions.standard+=/hammer_of_the_righteous
      spell.cast("Hammer of the Righteous", on => this.currentorbestTarget(), req => true),
      // actions.standard+=/crusader_strike
      spell.cast("Crusader Strike", on => this.currentorbestTarget(), req => true),
      // actions.standard+=/word_of_glory,if=buff.shining_light_free.up&(talent.blessed_assurance.enabled|(talent.lights_guidance.enabled&cooldown.hammerfall_icd.remains=0))
      spell.cast("Word of Glory", on => me, req => me.hasVisibleAura(327510) && (me.hasAura(328282) || (me.hasAura(427445) && spell.getCooldown("Hammerfall").timeleft === 0))),
      // actions.standard+=/avengers_shield
      spell.cast("Avenger's Shield", on => this.currentorbestTarget(), req => true),
      // actions.standard+=/eye_of_tyr,if=!talent.lights_deliverance.enabled
      spell.cast("Eye of Tyr", on => this.currentorbestTarget(), req => !me.hasAura(425518)),
      // actions.standard+=/word_of_glory,if=buff.shining_light_free.up
      spell.cast("Word of Glory", on => h.getPriorityTarget(), req => me.hasVisibleAura(327510)),
      // actions.standard+=/consecration,if=spell_targets.shield_of_the_righteous>=3
      spell.cast("Consecration", on => me, req => me.getEnemies(8).length >= 3),
      spell.cast("Blessed Hammer", on => me, req => me.powerByType(PowerType.HolyPower) < 5),
    );
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
    if (target !== null) {
      return target;
    }
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
    JMRPROTECTIONPALA.rotationEnabled = !JMRPROTECTIONPALA.rotationEnabled;
    console.info(`Rotation ${JMRPROTECTIONPALA.rotationEnabled ? 'enabled' : 'disabled'}`);
  }

  renderRotationState() {
    if (!JMRPROTECTIONPALA.rotationEnabled) {
      const drawList = imgui.getBackgroundDrawList();
      if (!drawList) return;

      const playerPos = me.position;
      const screenPos = wow.WorldFrame.getScreenCoordinates(playerPos);

      if (screenPos) {
        drawList.addText("OFF", { x: screenPos.x, y: screenPos.y - 20 }, colors.red);
      }
    }
  }

}

