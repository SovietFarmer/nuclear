import { Behavior, BehaviorContext } from '@/Core/Behavior';
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from '@/Core/Spell';
import Settings from '@/Core/Settings';
import objMgr from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { me } from '@/Core/ObjectManager';
import { defaultCombatTargeting as combat } from '@/Targeting/CombatTargeting';

// STATUS : DONE

// Important auras and buff IDs for Shadow Priest
const auras = {
  voidForm: 194249,                  // Void Form buff
  surgingDarkness: 252801,           // Surging Darkness buff
  surgeOfInsanity: 264774,           // Surge of Insanity buff
  deathspeaker: 392511,              // Deathspeaker buff
  mindDevourer: 373202,              // Mind Devourer buff
  devouringPlague: 335467,           // Devouring Plague debuff
  shadowWordPain: 589,               // Shadow Word: Pain debuff
  vampiricTouch: 34914,              // Vampiric Touch debuff
  voidBolt: 343355,                  // Void Bolt spell
  powerInfusion: 10060                // Power Infusion buff
};

export class ShadowPriestBehavior extends Behavior {
  name = 'Shadow Priest';
  context = BehaviorContext.Any;
  specialization = Specialization.Priest.Shadow;
  version = wow.GameVersion.Retail;

  // Tracking variables for opening sequence
  _openingSequenceStep = 1;
  _openingSequenceComplete = false;

  static settings = [
    {
      header: 'Cooldowns',
      options: [
        { type: 'checkbox', uid: 'PriestShadowUseCooldown', text: 'Use Cooldowns', default: true },
        { type: 'checkbox', uid: 'PriestShadowUseAoE', text: 'Use AoE Rotation', default: true },
        { type: 'checkbox', uid: 'PriestShadowOpeningSequence', text: 'Use Opening Sequence', default: true },
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
          spell.interrupt('Silence'),

          // Opening sequence for Archon Void Eruption
          new bt.Decorator(
            ret => Settings.PriestShadowOpeningSequence && !this.openingSequenceComplete(),
            this.openingSequence(),
          ),

          // AoE rotation for multiple targets (3+)
          new bt.Decorator(
            ret => Settings.PriestShadowUseAoE && this.enemiesAroundTarget(8) >= 3,
            this.aoeRotation(),
          ),

          // Standard single-target rotation
          this.standardRotation(),
        ),
      ),
    );
  }

 // Standard rotation based directly on the Archon Void Eruption APL
 standardRotation() {
    return new bt.Selector(
      // Keep DoTs up on targets
      spell.cast('Vampiric Touch', this.getCurrentTarget, () => {
        const remaining = this.getDebuffRemainingTime('Vampiric Touch');
        const isDying = this.isTargetDying(this.getCurrentTarget());
        const timeToLive = this.getCurrentTarget() ? this.getCurrentTarget().timeToLive || 20000 : 0;
        return remaining < 4000 && !isDying && timeToLive > 12000;
      }),
        
      spell.cast('Shadow Word: Pain', this.getCurrentTarget, () => {
        const remaining = this.getDebuffRemainingTime('Shadow Word: Pain');
        const isDying = this.isTargetDying(this.getCurrentTarget());
        return remaining < 4000 && !isDying;
      }),
      
      // Mindbender/Shadowfiend (high priority)
      spell.cast('Mindbender', this.getCurrentTarget, () => 
        this.useCooldowns() && this.hasSpell('Mindbender') && !this.mindbenderActive() && 
        this.getDebuffRemainingTime('Shadow Word: Pain') > 0 && 
        (!this.hasSpell('Dark Ascension') || spell.getCooldown('Dark Ascension').remains < 1500)),
        
      spell.cast('Shadowfiend', this.getCurrentTarget, () => 
        this.useCooldowns() && !this.hasSpell('Mindbender') && !this.mindbenderActive() && 
        this.getDebuffRemainingTime('Shadow Word: Pain') > 0 && 
        (!this.hasSpell('Dark Ascension') || spell.getCooldown('Dark Ascension').remains < 1500)),
      
      // Shadow Word: Death when target is below 20% or with Deathspeaker and DP ticking
      spell.cast('Shadow Word: Death', this.getCurrentTarget, () => {
        const targetHP = this.getCurrentTarget().healthPercent;
        const hasDP = this.getCurrentTarget().hasAura('Devouring Plague');
        const hasDS = me.hasAura('Deathspeaker');
        return targetHP < 20 || (hasDS && hasDP);
      }),
      
      // Void Bolt (highest priority during Void Form)
      spell.cast('Void Bolt', this.getCurrentTarget, () => 
        this.inVoidForm() && spell.getCooldown('Void Bolt').ready),
      
      // Devouring Plague to avoid insanity cap or with Mind Devourer
      spell.cast('Devouring Plague', this.getCurrentTarget, () => {
        const insanity = this.getInsanity();
        const insanityDeficit = 100 - insanity; // Assuming max insanity is 100
        const hasMD = me.hasAura('Mind Devourer');
        
        return (insanityDeficit <= 35) || (hasMD && spell.getCooldown('Mind Blast').ready) || 
               (this.inVoidForm() && this.hasSpell('Perfected Form'));
      }),
      
      // Void Torrent when DP is active
      spell.cast('Void Torrent', this.getCurrentTarget, () => {
        const dpRemaining = this.getDebuffRemainingTime('Devouring Plague');
        return (dpRemaining >= 2500) && !this.willOvercapChargesDuringChannel();
      }),
      
      // Shadow Crash
      spell.cast('Shadow Crash', this.getCurrentTarget, () => 
        this.getDebuffRemainingTime('Vampiric Touch') < 4000),
      
      // Mind Blast (use all charges if no Mind Devourer or prepping Void Eruption)
      spell.cast('Mind Blast', this.getCurrentTarget, () => {
        const hasMD = me.hasAura('Mind Devourer');
        const voidEruptionReady = spell.getCooldown('Void Eruption').ready;
        return !hasMD || (voidEruptionReady && this.hasSpell('Void Eruption'));
      }),
      
      // Halo (high priority if Void Eruption or Dark Ascension prep)
      spell.cast('Halo', this.getCurrentTarget, () => 
        this.useCooldowns() && this.hasSpell('Power Surge') && 
        (this.mindbenderActive() || !spell.getCooldown('Void Eruption').ready)),
      
      // Void Eruption (with Mind Blast charges on cooldown)
      spell.cast('Void Eruption', this.getCurrentTarget, () => 
        this.useCooldowns() && !this.inVoidForm() && this.mindBlastChargesFull() && this.mindbenderActive()),
      
      // Power Infusion during Void Form
      spell.cast('Power Infusion', on => me, () => 
        this.useCooldowns() && this.inVoidForm()),
      
      // Mind Spike/Mind Flay Insanity with 3+ stacks
      spell.cast('Mind Spike: Insanity', this.getCurrentTarget, () => {
        const stacks = me.getAuraStacks('Surge of Insanity');
        return stacks >= 3 && this.hasSpell('Mind Spike: Insanity');
      }),
        
      spell.cast('Mind Flay: Insanity', this.getCurrentTarget, () => {
        const stacks = me.getAuraStacks('Surge of Insanity');
        return stacks >= 3 && !this.hasSpell('Mind Spike: Insanity');
      }),
      
      // Devouring Plague regular usage
      spell.cast('Devouring Plague', this.getCurrentTarget, () => 
        this.getInsanity() >= 50 && !this.getCurrentTarget().hasAura('Devouring Plague')),
      
      // Mind Spike/Flay Insanity with any stacks
      spell.cast('Mind Spike: Insanity', this.getCurrentTarget, () => 
        me.hasAura('Surge of Insanity') && this.hasSpell('Mind Spike: Insanity')),
        
      spell.cast('Mind Flay: Insanity', this.getCurrentTarget, () => 
        me.hasAura('Surge of Insanity') && !this.hasSpell('Mind Spike: Insanity')),
      
      // Shadow Word: Death with Mindbender
      spell.cast('Shadow Word: Death', this.getCurrentTarget, () => 
        this.mindbenderActive() && (me.hasAura('Deathspeaker') || this.mindbenderRemainingTime() < 2000)),
      
      // Divine Star (if talented)
      spell.cast('Divine Star', this.getCurrentTarget, () => 
        this.hasSpell('Divine Star')),
      
      // Filler spells
      spell.cast('Mind Spike', this.getCurrentTarget, () => 
        this.hasSpell('Mind Spike')),
        
      spell.cast('Mind Flay', this.getCurrentTarget),
      
      // Movement spells
      spell.cast('Shadow Word: Death', this.getCurrentTarget, () => 
        me.isMoving()),
        
      spell.cast('Shadow Word: Pain', this.getCurrentTarget, () => 
        me.isMoving()),
    );
  }

  // AoE rotation for multiple targets
  aoeRotation() {
    return new bt.Selector(
      // Multi-DoT management (maintaining DoTs on multiple targets)
    //   this.multiDotTargets(),

      spell.cast('Vampiric Touch', on => combat.targets.find(unit => unit.inCombat() && !unit.hasAuraByMe('Vampiric Touch'))),
        
      // For Shadow Word: Pain  
      spell.cast('Shadow Word: Pain', on => combat.targets.find(unit => !unit.hasAuraByMe('Shadow Word: Pain')), req =>combat.targets.find(unit => unit.inCombat()) ),
      
      // Otherwise follow similar priority to single target with AoE focus
      spell.cast('Void Eruption', this.getCurrentTarget, () => 
        this.useCooldowns() && !this.inVoidForm() && this.mindBlastChargesFull()),
      
      spell.cast('Void Bolt', this.getCurrentTarget, () => 
        this.inVoidForm()),
      
      spell.cast('Mind Blast', this.getCurrentTarget, () => 
        !me.hasAura('Mind Devourer')),
      
      spell.cast('Halo', this.getCurrentTarget, () => 
        this.useCooldowns() && this.enemiesAroundTarget(30) >= 3),
      
      spell.cast('Devouring Plague', this.getCurrentTarget, () => 
        this.getInsanity() >= 50 && 
        (!this.getCurrentTarget().hasAura('Devouring Plague') || me.hasAura('Mind Devourer'))),
      
      spell.cast('Mind Sear', this.getCurrentTarget, () => 
        this.enemiesAroundTarget(10) >= 3),
      
      // Fallback to standard rotation
      this.standardRotation(),
    );
  }

  // Cooldowns usage logic
  cooldowns() {
    return new bt.Selector(
      // Shadowfiend/Mindbender
      spell.cast('Shadowfiend', this.getCurrentTarget, () => 
        this.useCooldowns() && !spell.getTimeSinceLastCast('Shadowfiend') < 120000),
        
      spell.cast('Mindbender', this.getCurrentTarget, () => 
        this.useCooldowns() && this.hasSpell('Mindbender') && !this.mindbenderActive()),
      
      // Halo with Mind Blast charges on cooldown
      spell.cast('Halo', this.getCurrentTarget, () => 
        this.useCooldowns() && this.mindBlastChargesFull() && !this.inVoidForm()),
      
      // Power Infusion (pair with trinkets)
      spell.cast('Power Infusion', on => me, () => 
        this.useCooldowns() && this.inVoidForm()),
    );
  }

  // Multi-DoT strategy for multiple targets
  multiDotTargets() {
    return new bt.Selector(
      // For Vampiric Touch
      spell.cast('Vampiric Touch', on => combat.targets.find(unit => unit.inCombat() && !unit.hasAuraByMe('Vampiric Touch'))),
        
      // For Shadow Word: Pain  
      spell.cast('Shadow Word: Pain', on => combat.targets.find(unit => unit.inCombat() && !unit.hasAuraByMe('Shadow Word: Pain'))),
    );
  }

  // Opening sequence for optimal burst damage
  openingSequence() {
    return new bt.Selector(
      // 1. Cast Vampiric Touch to apply dots
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 1 ? bt.Status.Success : bt.Status.Failure),
        spell.cast('Vampiric Touch', this.getCurrentTarget),
        new bt.Action(() => { this._openingSequenceStep = 2; return bt.Status.Success; })
      ),
      
      // 2. Cast Shadowfiend/Mindbender
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 2 ? bt.Status.Success : bt.Status.Failure),
        new bt.Selector(
          spell.cast('Shadowfiend', this.getCurrentTarget, () => !this.hasSpell('Mindbender')),
          spell.cast('Mindbender', this.getCurrentTarget, () => this.hasSpell('Mindbender'))
        ),
        new bt.Action(() => { this._openingSequenceStep = 3; return bt.Status.Success; })
      ),
      
      // 3. Cast first Mind Blast
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 3 ? bt.Status.Success : bt.Status.Failure),
        spell.cast('Mind Blast', this.getCurrentTarget),
        new bt.Action(() => { this._openingSequenceStep = 4; return bt.Status.Success; })
      ),
      
      // 4. Cast second Mind Blast
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 4 ? bt.Status.Success : bt.Status.Failure),
        spell.cast('Mind Blast', this.getCurrentTarget),
        new bt.Action(() => { this._openingSequenceStep = 5; return bt.Status.Success; })
      ),
      
      // 5. Cast Halo
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 5 ? bt.Status.Success : bt.Status.Failure),
        spell.cast('Halo', this.getCurrentTarget),
        new bt.Action(() => { this._openingSequenceStep = 6; return bt.Status.Success; })
      ),
      
      // 6. Cast Void Eruption
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 6 ? bt.Status.Success : bt.Status.Failure),
        spell.cast('Void Eruption', this.getCurrentTarget),
        new bt.Action(() => { this._openingSequenceStep = 7; return bt.Status.Success; })
      ),
      
      // 7. Cast Void Bolt and Power Infusion
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 7 ? bt.Status.Success : bt.Status.Failure),
        spell.cast('Void Bolt', this.getCurrentTarget),
        spell.cast('Power Infusion', on => me),
        new bt.Action(() => { this._openingSequenceStep = 8; return bt.Status.Success; })
      ),
      
      // 8. Cast Devouring Plague
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 8 ? bt.Status.Success : bt.Status.Failure),
        spell.cast('Devouring Plague', this.getCurrentTarget),
        new bt.Action(() => { this._openingSequenceStep = 9; return bt.Status.Success; })
      ),
      
      // 9. Cast Void Torrent
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 9 ? bt.Status.Success : bt.Status.Failure),
        spell.cast('Void Torrent', this.getCurrentTarget),
        new bt.Action(() => { this._openingSequenceStep = 10; return bt.Status.Success; })
      ),
      
      // 10. Cast Void Bolt
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 10 ? bt.Status.Success : bt.Status.Failure),
        spell.cast('Void Bolt', this.getCurrentTarget),
        new bt.Action(() => { this._openingSequenceStep = 11; return bt.Status.Success; })
      ),
      
      // 11. Cast Mind Flay: Insanity or Mind Spike: Insanity
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 11 ? bt.Status.Success : bt.Status.Failure),
        new bt.Selector(
          spell.cast('Mind Spike: Insanity', this.getCurrentTarget, () => this.hasSpell('Mind Spike: Insanity')),
          spell.cast('Mind Flay: Insanity', this.getCurrentTarget)
        ),
        new bt.Action(() => { this._openingSequenceStep = 12; return bt.Status.Success; })
      ),
      
      // Remaining steps of the opener
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 12 ? bt.Status.Success : bt.Status.Failure),
        spell.cast('Devouring Plague', this.getCurrentTarget),
        new bt.Action(() => { this._openingSequenceStep = 13; return bt.Status.Success; })
      ),
      
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 13 ? bt.Status.Success : bt.Status.Failure),
        spell.cast('Mind Blast', this.getCurrentTarget),
        new bt.Action(() => { this._openingSequenceStep = 14; return bt.Status.Success; })
      ),
      
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 14 ? bt.Status.Success : bt.Status.Failure),
        spell.cast('Void Bolt', this.getCurrentTarget),
        new bt.Action(() => { this._openingSequenceStep = 15; return bt.Status.Success; })
      ),
      
      new bt.Sequence(
        new bt.Action(() => this._openingSequenceStep === 15 ? bt.Status.Success : bt.Status.Failure),
        new bt.Selector(
          spell.cast('Mind Spike: Insanity', this.getCurrentTarget, () => this.hasSpell('Mind Spike: Insanity')),
          spell.cast('Mind Flay: Insanity', this.getCurrentTarget)
        ),
        new bt.Action(() => { 
          this._openingSequenceStep = 16; 
          this._openingSequenceComplete = true;
          return bt.Status.Success; 
        })
      ),
      
      // If we reach this point, fall back to standard rotation as opening is complete
      new bt.Action(() => {
        if (this._openingSequenceStep >= 16) {
          this._openingSequenceComplete = true;
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      })
    );
  }

  // Helper methods
  // Get current target
  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  // Check if opening sequence is already complete
  openingSequenceComplete() {
    return this._openingSequenceComplete === true;
  }

  useCooldowns() {
    return Settings.PriestShadowUseCooldown === true;
  }

  inVoidForm() {
    return me.hasAura('Void Form');
  }

  mindbenderActive() {

    const mindbender = objMgr.objects.forEach(obj => {
            // Prüfe, ob das Objekt eine Einheit ist
            if (obj instanceof wow.CGUnit) {
                // Prüfe, ob die Einheit vom Spieler beschworen wurde und ein Wild Imp ist
                if (obj.createdBy && 
                    me.guid && 
                    obj.createdBy.equals(me.guid) && 
                    (obj.name === 'Mindbender' || obj.Name === 'Shadowfiend')) {
                    count++;
                }
            }
        });
    // Check if Mindbender or Shadowfiend is active (look for pet with relevant name)
     
    return mindbender !== undefined ? mindbender[0] : undefined;
  }

  mindbenderRemainingTime() {
    // This would need proper implementation based on the game's API
    // Approximate remaining time of Mindbender/Shadowfiend
    const mindbender = objMgr.objects.forEach(obj => {
        // Prüfe, ob das Objekt eine Einheit ist
        if (obj instanceof wow.CGUnit) {
            // Prüfe, ob die Einheit vom Spieler beschworen wurde und ein Wild Imp ist
            if (obj.createdBy && 
                me.guid && 
                obj.createdBy.equals(me.guid) && 
                (obj.name === 'Mindbender' || obj.Name === 'Shadowfiend')) {
                count++;
            }
        }
    });
    return mindbender ? mindbender[0].duration : 0;
  }

  allDotsUp() {
    const target = this.getCurrentTarget();
    return target.hasAura('Shadow Word: Pain') && 
           target.hasAura('Vampiric Touch') && 
           target.hasAura('Devouring Plague');
  }

  mindBlastChargesFull() {
    // Check if Mind Blast has no charges left (meaning they're all on cooldown)
    return spell.getCharges('Mind Blast') === 0 && spell.getCooldown('Mind Blast').timeleft > 0;
  }

  willOvercapChargesDuringChannel() {
    // Calculate if Mind Blast or Surge of Insanity charges will overcap during Void Torrent channel
    const voidTorrentDuration = 3000; // 3 seconds channel
    const mbCooldown = spell.getCooldown('Mind Blast');
    
    // If any Mind Blast charge will come off cooldown during Void Torrent
    if (mbCooldown.timeleft > 0 && mbCooldown.timeleft < voidTorrentDuration) {
      return true;
    }
    
    // If Surge of Insanity is almost at max stacks
    if (me.getAuraStacks('Surge of Insanity') >= 2) {
      return true;
    }
    
    return false;
  }

  hasSpell(spellName) {
    return spell.isSpellKnown(spellName);
  }

  getInsanity() {
    return me.powerByType(PowerType.Insanity);
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

  enemiesAroundTarget(range) {
    const target = this.getCurrentTarget();
    return target ? target.getUnitsAroundCount(range) : 0;
  }

  // Multi-DoT helper methods
  hasValidMultiDotTarget(dotName) {
    return this.findNoDotTarget(dotName) !== null;
  }

  findNoDotTarget(dotName) {
    let nextDotTarget = null;
    const validTarget = objMgr.objects.forEach(obj => {
        // Prüfe, ob das Objekt eine Einheit ist
        if (obj instanceof wow.CGUnit) {
            // Prüfe, ob die Einheit vom Spieler beschworen wurde und ein Wild Imp ist
            if (!obj.hasAura(dotName) && obj.inCombat()) {
                nextDotTarget = obj.guid;
                console.debug('Valid Target Found')
            }
        }
    });
// Check if Mindbender or Shadowfiend is active (look for pet with relevant name)
 
return validTarget !== undefined ? validTarget[0] : undefined;
    // // Find a target without the specified DoT
    // const validTargets = combat.targets.find(unit => 
    //   !unit.hasAura('Vampiric Touch'));

    // if(validTargets)
    //     console.debug("Found #Targets" + validTargets);  
    // else
    //     console.debug("No Targets found");
    // return validTargets ? validTargets : null;
  }

  // Helper function to determine if a target is "dying" (not worth applying DoTs)
isTargetDying(target) {
    if (!target) return true;
  
    // Check if the target has very low health
    if (target.healthPercent < 10) return true;
    
    // If the timeToLive property exists, use it
    if (target.timeToLive !== undefined && target.timeToLive < 4000) {
      return true;
    }
    
    // Additional check for bosses - never consider them "dying" until very low health
    if (target.classification === 'worldboss' || target.classification === 'rareelite' || target.classification === 'elite') {
      return target.healthPercent < 5;
    }
    
    // Alternative approach if other properties aren't available
    // Check if the target is losing health rapidly
    if (this._lastHealthValues === undefined) {
      this._lastHealthValues = new Map();
    }
    
    const currentTime = wow.frameTime;
    const currentHealth = target.healthPercent;
    
    // Get last recorded health and time
    const lastRecord = this._lastHealthValues.get(target.guid.toString());
    
    if (lastRecord) {
      const { health, time } = lastRecord;
      const timeDiff = currentTime - time;
      
      // Only check if enough time has passed for meaningful measurement
      if (timeDiff > 1000) {
        // Calculate rate of health loss (percent per second)
        const healthLossRate = ((health - currentHealth) / timeDiff) * 1000;
        
        // If losing more than 20% health per second, consider "dying"
        if (healthLossRate > 20 && currentHealth < 30) {
          return true;
        }
        
        // Update record
        this._lastHealthValues.set(target.guid.toString(), { health: currentHealth, time: currentTime });
      }
    } else {
      // Create new record
      this._lastHealthValues.set(target.guid.toString(), { health: currentHealth, time: currentTime });
    }
    
    // Clean up old records (targets we haven't seen in a while)
    if (currentTime % 10000 < 100) { // Roughly every 10 seconds
      for (const [guid, record] of this._lastHealthValues.entries()) {
        if (currentTime - record.time > 20000) { // 20 seconds
          this._lastHealthValues.delete(guid);
        }
      }
    }
    
    // Default to not dying if we don't have enough information
    return false;
  }
}