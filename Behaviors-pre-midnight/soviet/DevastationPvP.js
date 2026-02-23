import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from "@/Core/BehaviorTree";
import common from "@/Core/Common";
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import Settings from "@/Core/Settings";
import EvokerCommon from "@/Behaviors/EvokerCommon";
import { defaultCombatTargeting as Combat, defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import Specialization from "@/Enums/Specialization";

const auras = {
  dragonRage: 375087,
  essenceBurst: 359618,
  burnout: 375802,
  massDisintegrate: 436336,
  leapingFlames: 370901,
  iridescenceBlue: 386399,
  shatteringStar: 370452,
  tipTheScales: 370553,
};

export class EvokerDevastationPVPBehavior extends Behavior {
  name = "PvP Devastation Evoker";
  context = BehaviorContext.Any;
  specialization = Specialization.Evoker.Devastation;

  static settings = [
    {
      header: "Defensives",
      options: [
        {type: "checkbox", uid: "EvokerPVPDevastationUseRenewingBlaze", text: "Use Renewing Blaze", default: true},
        {type: "checkbox", uid: "EvokerPVPDevastationUseObsidianScales", text: "Use Obsidian Scales", default: true},
      ]
    },
    {
      header: "Damage",
      options: [
        {type: "checkbox", uid: "EvokerPVPDevastationUseDeepBreath", text: "Use Deep Breath", default: true},
        {
          type: "slider",
          uid: "EvokerPVPDevastationDeepBreathMinTargets",
          text: "Deep Breath Minimum Targets",
          min: 1,
          max: 10,
          default: 3
        },
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      new bt.Action(() => EvokerCommon.handleEmpoweredSpell()),
      common.waitForCastOrChannel(),
      spell.cast("Renewing Blaze", on => me,
        req => Settings.EvokerPVPDevastationUseRenewingBlaze && (me.predictedHealthPercent < 70)
      ),
      spell.cast("Obsidian Scales", on => me,
        req => Settings.EvokerPVPDevastationUseObsidianScales && (me.pctHealth < 50) && !me.hasAura("Renewing Blaze")
      ),
      spell.interrupt("Quell", true),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown() && this.shouldHealMyself(),
        new bt.Selector(
          spell.cast("Living Flame", on => me, req => this.shouldHealMyself()),
        )
      ),
      common.waitForTarget(),
      common.waitForFacing(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown() && me.target && me.distanceTo(me.target) < 25 && Combat.burstToggle,
        this.burstRotation()
      ),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown() && me.distanceTo(me.target) < 25 && !Combat.burstToggle,
        this.sustainedRotation()
      )
    );
  }

  burstRotation() {
    return new bt.Selector(
      spell.cast("Fire Breath", on => me.target, req => me.hasAuraByMe(auras.tipTheScales)),
      spell.cast("Landslide", on => me.target, req => me.target && me.distanceTo(me.target) > 15 && !me.targetUnit.isRooted() && !me.targetUnit.isStunned() && !me.targetUnit.isSlowed()),
      EvokerCommon.castEmpowered("Eternity Surge", 1, on => me.target, req => this.shouldCastEternitySurge()),
      spell.cast("Deep Breath", on => me.target, req => true),
      spell.cast("Dragonrage", on => me.target, req => me.target),
      spell.cast("Shattering Star", on => me.target, req => this.shouldCastShatteringStar()),
      spell.cast("Tip the Scales", on => me, req => me.hasAuraByMe(auras.dragonRage)),
      spell.cast("Living Flame", on => heal.getPriorityPVPHealTarget(), req => me.hasAura(auras.burnout) && heal.getPriorityPVPHealTarget() < 30),
      spell.cast("Living Flame", on => me.target, req => me.hasAura(auras.burnout)),
      spell.cast("Disintegrate", on => me.target, req => true),
      spell.cast("Azure Strike", on => me.target, req => true),
    );
  }

  sustainedRotation() {
    return new bt.Selector(
      EvokerCommon.castEmpowered("Eternity Surge", 1, on => me.target, req => this.shouldCastEternitySurge()),
      spell.cast("Shattering Star", on => me.target, req => this.shouldCastShatteringStar()),
      spell.cast("Disintegrate", on => me.target, req => true),
      EvokerCommon.castEmpowered("Fire Breath", 4, on => me.target, req => true),
      spell.cast("Verdant Embrace", on => heal.getPriorityPVPHealTarget(), req => heal.getPriorityPVPHealTarget().predictedHealthPercent < 70),
      spell.cast("Deep Breath",
        on => {
          const bestTarget = EvokerCommon.findBestDeepBreathTarget();
          return bestTarget.unit ? bestTarget.unit.position : null;
        },
        req => {
          if (!Settings.EvokerPVPDevastationUseDeepBreath) return false;
          const bestTarget = EvokerCommon.findBestDeepBreathTarget();
          return combat.targets.length > 2 && bestTarget.count >= Settings.EvokerPVPDevastationDeepBreathMinTargets;
        }
      ),
      spell.cast("Living Flame", on => heal.getPriorityPVPHealTarget(), req => me.hasAura(auras.burnout) && heal.getPriorityPVPHealTarget() < 30),
      spell.cast("Living Flame", on => me.target, req => me.hasAura(auras.burnout)),
      spell.cast("Disintegrate", on => me.target, req => me.hasAura(auras.essenceBurst)),
      spell.cast("Azure Strike", on => me.target, req => true),
    );
  }

  shouldCastShatteringStar() {
    if (!me.target) {
      return false;
    }
    const shatteringStar = me.target.getAura(auras.shatteringStar);
    if (!shatteringStar) return true;
  }

  shouldCastEternitySurge() {
    return !me.hasAuraByMe(auras.iridescenceBlue) && !me.hasAura(auras.tipTheScales)
  }

  castEternitySurge() {
    return new bt.Decorator(
      ret => combat.targets.length > 0,
      new bt.Sequence(
        EvokerCommon.castEmpowered("Eternity Surge", this.getEternitySurgeEmpowerLevel(), on => me.target, ret => true)
      )
    );
  }

  shouldHealMyself() {
    return (me.getPlayerEnemies(20) < 1) && me.predictedHealthPercent < 70;
  }

  getEternitySurgeEmpowerLevel() {
    const targetCount = combat.targets.length;
    if (targetCount >= 7) return 4;
    if (targetCount >= 5) return 3;
    if (targetCount >= 3) return 2;
    return 1;
  }
}
