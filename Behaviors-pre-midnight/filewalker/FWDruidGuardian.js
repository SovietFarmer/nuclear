import { Behavior, BehaviorContext } from '@/Core/Behavior';
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from '@/Core/Spell';
import Settings from '@/Core/Settings';
import { PowerType } from "@/Enums/PowerType";
import { me } from '@/Core/ObjectManager';
import { defaultCombatTargeting as combat } from '@/Targeting/CombatTargeting';

//STATUS : FIXED

const auras = {
  ironfur: 192081,
  frenziedRegeneration: 22842,
  barkskin: 22812,
  survivalInstincts: 61336,
  bristlingFur: 155835,
  galacticGuardian: 213708,
  gore: 93622,
  pulverize: 158792,
  thrash: 192090,
  berserk: 50334,
  incarnationGuardian: 102558
};

export class GuardianDruidBehavior extends Behavior {
  name = 'FW Guardian Druid';
  context = BehaviorContext.Any;
  specialization = Specialization.Druid.Guardian;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: 'Guardian Settings',
      options: [
        { type: 'checkbox', uid: 'DruidGuardianUseCooldown', text: 'Use Defensive Cooldowns', default: true },
        { type: 'checkbox', uid: 'DruidGuardianUseOffensiveCooldown', text: 'Use Offensive Cooldowns', default: true },
        { type: 'slider', uid: 'DruidGuardianIronfurThreshold', text: 'Ironfur HP Threshold', default: 80, min: 1, max: 100 },
        { type: 'slider', uid: 'DruidGuardianFrenziedRegenThreshold', text: 'Frenzied Regeneration HP Threshold', default: 65, min: 1, max: 100 },
        { type: 'slider', uid: 'DruidGuardianBarkskinThreshold', text: 'Barkskin HP Threshold', default: 60, min: 1, max: 100 },
        { type: 'slider', uid: 'DruidGuardianSurvivalInstinctsThreshold', text: 'Survival Instincts HP Threshold', default: 40, min: 1, max: 100 },
      ],
    },
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      new bt.Action(() => (this.getCurrentTarget() === null ? bt.Status.Success : bt.Status.Failure)),
      common.waitForTarget(),
      common.waitForFacing(),
      common.waitForCastOrChannel(),
      
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          spell.interrupt('Skull Bash'),
          // Move defensiveCooldowns here to ensure it runs
          this.defensiveCooldowns(),

          new bt.Decorator(
            req => this.enemiesAroundMe(8) >= 3,
            new bt.Selector(
              this.aoe()
            )
          ),

          new bt.Decorator(
            req => this.enemiesAroundMe(8) < 3,
            new bt.Selector(
              this.singleTarget()
            )
          ),
        ),
      ),
    );
  }

  singleTarget() {
    return new bt.Selector(
      // Keep Moonfire up
      spell.cast('Moonfire', this.getCurrentTarget, () => 
        this.getDebuffRemainingTime('Moonfire') < 3000 || !this.getCurrentTarget().hasAura('Moonfire')),
      
      // Use Ravage during Berserk/Incarnation instead of Mangle
      spell.cast('Ravage', this.getCurrentTarget, () => 
        this.isBerserkActive()),
        
      // Use Mangle on proc
      spell.cast('Mangle', this.getCurrentTarget, () => me.hasAura('Gore')),
      
      // Use Pulverize if we have the talent and the target has 3 stacks of Thrash
      spell.cast('Pulverize', this.getCurrentTarget, () => 
        this.hasTalent('Pulverize') && 
        this.getDebuffStacks('Thrash') >= 2 && 
        this.getDebuffRemainingTime('Thrash') > 1500),
      
      // Maintain Thrash debuff
      spell.cast('Thrash', this.getCurrentTarget, () => 
        this.getDebuffRemainingTime('Thrash') < 3000 || !this.getCurrentTarget().hasAura('Thrash')),
      
      // Swipe if Thrash is on cooldown
      spell.cast('Swipe', this.getCurrentTarget, () => !spell.canCast('Thrash')),
      
      // Maul if we have excess rage and not actively mitigating big damage
      spell.cast('Maul', this.getCurrentTarget, () => 
        this.getRage() > 80 && me.pctHealth > Settings.DruidGuardianIronfurThreshold),
      
      // Use Ravage during Berserk/Incarnation as primary rage generator
      spell.cast('Ravage', this.getCurrentTarget, () => 
        this.isBerserkActive()),
      
      // Use Mangle as our primary rage generator
      spell.cast('Mangle', this.getCurrentTarget),
      
      // Ironfur if we need more physical mitigation
      // Each stack has its own duration, so we can maintain multiple stacks
      spell.cast('Ironfur', on => me, () => 
        this.getRage() >= 40 && 
        (me.pctHealth <= Settings.DruidGuardianIronfurThreshold || 
         this.shouldStackIronfur())),
      
      // Thrash as filler
      spell.cast('Thrash', this.getCurrentTarget),
      
      // Swipe as filler
      spell.cast('Swipe', this.getCurrentTarget),
    );
  }

  aoe() {
    return new bt.Selector(
      // Maintain Thrash debuff on multiple targets - higher priority in AoE
      spell.cast('Thrash', this.getCurrentTarget, () => 
        this.getDebuffRemainingTime('Thrash') < 4500 || !this.getCurrentTarget().hasAura('Thrash')),
      
      // Swipe for AoE damage and rage generation
      spell.cast('Swipe', this.getCurrentTarget),
      
      // Use Ravage during Berserk/Incarnation - great for AoE since it hits multiple targets
      spell.cast('Ravage', this.getCurrentTarget, () => 
        this.isBerserkActive()),
      
      // Use Mangle on proc 
      spell.cast('Mangle', this.getCurrentTarget, () => me.hasAura('Gore')),
      
      // Use Ironfur when tanking multiple mobs - more aggressive stacking for AoE
      spell.cast('Ironfur', on => me, () => 
        this.getRage() >= 40 && 
        (me.pctHealth <= Settings.DruidGuardianIronfurThreshold || 
         this.shouldStackIronfur(true))),
      
      // Keep Moonfire up on main target
      spell.cast('Moonfire', this.getCurrentTarget, () => 
        this.getDebuffRemainingTime('Moonfire') < 3000 || !this.getCurrentTarget().hasAura('Moonfire')),
      
      // Use Pulverize if we have the talent and the target has 3 stacks of Thrash
      spell.cast('Pulverize', this.getCurrentTarget, () => 
        this.hasTalent('Pulverize') && 
        this.getDebuffStacks('Thrash') >= 2 && 
        this.getDebuffRemainingTime('Thrash') > 1500),
      
      // Use Ravage during Berserk/Incarnation as stronger AoE ability
      spell.cast('Ravage', this.getCurrentTarget, () => 
        this.isBerserkActive()),
      
      // Use Mangle as a strong single target ability even in AoE
      spell.cast('Mangle', this.getCurrentTarget),
      
      // Thrash as filler
      spell.cast('Thrash', this.getCurrentTarget),
    );
  }

  defensiveCooldowns() {
    return new bt.Selector(
      // Frenzied Regeneration for moderate healing
      spell.cast('Frenzied Regeneration', on => me, () => 
        me.pctHealth <= Settings.DruidGuardianFrenziedRegenThreshold && 
        !me.hasAura('Frenzied Regeneration') && 
        this.useDefensiveCooldowns()),
      
      // Barkskin for moderate damage reduction
      spell.cast('Barkskin', on => me, () => 
        me.pctHealth <= Settings.DruidGuardianBarkskinThreshold && 
        !me.hasAura('Barkskin') && 
        this.useDefensiveCooldowns()),
      
      // Survival Instincts for major damage reduction
      spell.cast('Survival Instincts', on => me, () => 
        me.pctHealth <= Settings.DruidGuardianSurvivalInstinctsThreshold && 
        !me.hasAura('Survival Instincts') && 
        this.useDefensiveCooldowns()),
      
      // Bristling Fur for rage generation if talented
      spell.cast('Bristling Fur', on => me, () => 
        this.hasTalent('Bristling Fur') && 
        this.getRage() < 30 && 
        this.useDefensiveCooldowns()),
      
      // Ironfur for physical damage mitigation (higher priority during defensiveCooldowns)
      spell.cast('Ironfur', on => me, () => 
        this.getRage() >= 40 && 
        (me.pctHealth <= Settings.DruidGuardianIronfurThreshold || 
         this.shouldStackIronfur(true))),
      
      // Offensive cooldowns that also have defensive value
      spell.cast('Berserk', on => me, () => 
        this.useOffensiveCooldowns() && 
        this.hasTalent('Berserk')),
      
      spell.cast('Incarnation: Guardian of Ursoc', on => me, () => 
        this.useOffensiveCooldowns() && 
        this.hasTalent('Incarnation: Guardian of Ursoc')),
      
      // Rage of the Sleeper (if present in this version)
      spell.cast('Rage of the Sleeper', on => me, () => 
        this.useOffensiveCooldowns() && 
        this.hasTalent('Rage of the Sleeper')),
    );
  }

  hasTalent(talentName) {
    return me.hasAura(talentName);
  }

  useDefensiveCooldowns() {
    return Settings.DruidGuardianUseCooldown;
  }

  useOffensiveCooldowns() {
    return Settings.DruidGuardianUseOffensiveCooldown;
  }

  getRage() {
    return me.powerByType(PowerType.Rage);
  }

  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }

  getDebuffRemainingTime(debuffName) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    const debuff = target.getAura(debuffName);
    return debuff ? debuff.remaining : 0;
  }

  getDebuffStacks(debuffName) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    const debuff = target.getAura(debuffName);
    return debuff ? debuff.stacks : 0;
  }

  enemiesAroundMe(range) {
    return me.getUnitsAroundCount(range);
  }

  enemiesAroundTarget(range) {
    const target = this.getCurrentTarget();
    return target ? target.getUnitsAroundCount(range) : 0;
  }
  
  /**
   * Checks if Berserk or Incarnation: Guardian of Ursoc is active
   * @returns {boolean} - True if either Berserk or Incarnation is active
   */
  isBerserkActive() {
    return me.hasAura('Berserk') || me.hasAura('Incarnation: Guardian of Ursoc');
  }
  
  /**
   * Determines if we should stack more Ironfur
   * @param {boolean} aoe - Whether we're in an AoE situation, which makes stacking more aggressive
   * @returns {boolean} - True if we should cast Ironfur
   */
  shouldStackIronfur(aoe = false) {
    // Check if we already have Ironfur aura
    const ironfurAura = me.getAura('Ironfur');
    
    // If we don't have Ironfur at all, we should cast it
    if (!ironfurAura) return true;
    
    // Get the number of stacks
    const stacks = ironfurAura.stacks || 1;
    
    // Get the remaining time of the Ironfur buff
    const remaining = ironfurAura.remaining;
    
    // In AoE situations, we want more stacks of Ironfur
    const maxDesiredStacks = aoe ? 3 : 2;
    
    // If we have a physical damage spike incoming or are tanking multiple mobs
    const enemyCount = this.enemiesAroundMe(8);
    const inDanger = me.pctHealth < 60 || enemyCount > 2;
    
    // If we're in danger, we want to maintain maximum stacks possible
    if (inDanger && stacks < maxDesiredStacks) {
      return true;
    }
    
    // If our Ironfur is about to expire (less than 3 seconds), refresh it
    if (remaining < 3000) {
      return true;
    }
    
    // If we're fighting a boss (has more than 5M health), stack more Ironfur
    const target = this.getCurrentTarget();
    if (target && target.health > 5000000 && stacks < maxDesiredStacks) {
      return true;
    }
    
    // Otherwise, don't stack more Ironfur
    return false;
  }
}