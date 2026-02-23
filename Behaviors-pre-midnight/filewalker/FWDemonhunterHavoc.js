import { Behavior, BehaviorContext } from '@/Core/Behavior';
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from '@/Core/Spell';
import Settings from '@/Core/Settings';
import CombatTimer from '@/Core/CombatTimer';
import { PowerType } from "@/Enums/PowerType";
import { me } from '@/Core/ObjectManager';
import { defaultCombatTargeting as combat } from '@/Targeting/CombatTargeting';

const shouldFelRush = false;

const auras = {
  metamorphosis: 187827,
  immolationAura: 258920,
  unboundChaos: 347462,
  glaiveFlurry: 393919,
  rendingStrike: 389978,
  initiative: 391215,
  inertia: 427640,
  thrillOfTheFight: 427717,
  essenceBreak: 320338,
  demonsurge: 370884,
  felBarrage: 258925,
  cycloneStrike: 409831,
  burningSoul: 391400,
  innerDemon: 390145,
  tacticalRetreat: 389890,
  chaosTheory: 389687,
  burningWound: 391189
};

export class HavocDemonHunterBehavior extends Behavior {
  name = 'FW Havoc Demon Hunter';
  context = BehaviorContext.Any;
  specialization = Specialization.DemonHunter.Havoc;
  version = wow.GameVersion.Retail;

  constructor() {
    super();
    this._lastSpells = new Array(5).fill('');
  }

  static settings = [
    {
      header: 'Havoc Settings',
      options: [
        { type: 'checkbox', uid: 'DHHavocUseOffensiveCooldown', text: 'Use Offensive Cooldowns', default: true },
        { type: 'checkbox', uid: 'DHHavocUseDefensiveCooldown', text: 'Use Defensive Cooldowns', default: true },
    
        { type: 'checkbox', uid: 'DHHavocHeroTreeAldrachi', text: 'Use Aldrachi Reaver Tree', default: true },
        { type: 'checkbox', uid: 'DHHavocHeroTreeFelscarred', text: 'Use Felscarred Tree', default: false },
        { type: 'checkbox', uid: 'DHHavocPickUpSoulFragments', text: 'Auto Pick Up Soul Fragments', default: true },
        { type: 'slider', uid: 'DHHavocFuryThreshold', text: 'Chaos Strike Fury Threshold', default: 80, min: 30, max: 120 },
        { type: 'slider', uid: 'DHHavocBlurThreshold', text: 'Blur HP Threshold', default: 40, min: 1, max: 100 },
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
          spell.interrupt('Disrupt'),
          
          // Handle Burning Wound target switching for Demon Blades builds
          this.handleBurningWoundTargets(),
          
          // Execute primary rotation based on hero tree selection
          new bt.Selector(
            new bt.Decorator(
              req => Settings.DHHavocHeroTreeAldrachi,
              new bt.Selector(
                this.defensiveCooldowns(),
                this.aldrachiReaver()
              )
            ),
            new bt.Decorator(
              req => Settings.DHHavocHeroTreeFelscarred,
              new bt.Selector(
                this.defensiveCooldowns(),
                this.felScarred()
              )
            )
          )
        ),
      ),
    );
  }

  handleBurningWoundTargets() {
    return new bt.Selector(
      // Retarget for Burning Wound uptime in multi-target scenarios
      spell.cast('Throw Glaive', target => {
        // Find a target without Burning Wound if we have slots available
        const potentialTargets = combat.targets.filter(unit => 
          common.validTarget(unit) && 
          !unit.hasAura('Burning Wound') && 
          me.isFacing(unit)
        );
        
        if (potentialTargets.length > 0 && 
            me.hasAura('Burning Wound') && 
            me.hasAura('Demon Blades') && 
            this.getActiveDotCount('Burning Wound') < (this.enemiesAroundMe(8) > 3 ? 3 : this.enemiesAroundMe(8))) {
          return potentialTargets[0];
        }
        return null;
      }),
      
      // Target boss in multi-target if we already have max Burning Wounds applied
      spell.cast('Throw Glaive', target => {
        const bossTargets = combat.targets.filter(unit => 
          common.validTarget(unit) && 
          (unit.classification === 3 || unit.classification === 1) && // 3 is worldboss, 1 is elite
          me.isFacing(unit)
        );
        
        if (bossTargets.length > 0 && 
            me.hasAura('Burning Wound') && 
            me.hasAura('Demon Blades') && 
            this.getActiveDotCount('Burning Wound') >= 3) {
          return bossTargets[0];
        }
        return null;
      })
    );
  }

  aldrachiReaver() {
    return new bt.Selector(
      // Handle different enemy counts
      new bt.Decorator(
        req => this.enemiesAroundMe(8) >= 3,
        new bt.Selector(
          this.aldrachiCooldowns(),
          this.handleFelBarrage(),
          this.aldrachiAoe()
        )
      ),
      
      new bt.Decorator(
        req => this.enemiesAroundMe(8) < 3,
        new bt.Selector(
          this.aldrachiCooldowns(),
          this.handleFelBarrage(),
          this.aldrachiSingleTarget()
        )
      )
    );
  }

  aldrachiCooldowns() {
    return new bt.Selector(
      // Metamorphosis
      spell.cast('Metamorphosis', on => me, () => {
        const eyeBeamCD = spell.getCooldown('Eye Beam') ? spell.getCooldown('Eye Beam').timeleft : 0;
        return this.useOffensiveCooldowns() && 
          ((eyeBeamCD >= 15000 || 
            (((me.hasAura('Cycle of Hatred') && eyeBeamCD >= 13000)) && 
           (!me.hasAura('Essence Break') || this.getDebuffRemainingTime('Essence Break') > 0) && 
           !me.hasAura('Fel Barrage')) && 
          !me.hasAura('Inner Demon') && 
          (!me.hasAura('Restless Hunter') || spell.getCooldown('Blade Dance').timeleft > 1500) && 
          !me.hasAura('Inertia') && 
          !me.hasAura('Essence Break'))) && 
          this.getTimeSinceStart() > 10000;
      }),
      
      // The Hunt
      spell.cast('The Hunt', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.useOffensiveCooldowns() && 
          this.getDebuffRemainingTime('Essence Break') <= 0 && 
          (!me.hasAura('Initiative') || me.hasAura('Initiative')) && 
          !me.hasAura('Reaver\'s Glaive') && 
          (this.getAuraRemainingTime('Metamorphosis') > 5000 || !me.hasAura('Metamorphosis')) && 
          this.getTimeSinceStart() > 5000 && 
          (!me.hasAura('Inertia') && !me.hasAura('Unbound Chaos') || !me.hasAura('Inertia Trigger'));
      }),
      
      // Essence Break
      spell.cast('Essence Break', target => {
        return this.getCurrentTarget();
      }, () => {
        const bladeCD = spell.getCooldown('Blade Dance').timeleft;
        return this.getFury() > 20 && 
          (bladeCD < 1500 || spell.canCast('Blade Dance')) && 
          (!me.hasAura('Unbound Chaos') && !me.hasAura('Inertia') || me.hasAura('Inertia')) && 
          (!me.hasAura('Shattered Destiny') || spell.getCooldown('Eye Beam').timeleft > 4000);
      })
    );
  }

  aldrachiSingleTarget() {
    
    return new bt.Selector(
      
      spell.cast("Fel Rush", target => {
        return this.getCurrentTarget();
      }, () => {
        return this.shouldUseFelRushAfterVengefulRetreat();
      }),

      // Keep Sigil of Flame up
      spell.cast('Sigil of Flame', target => {
        return this.getCurrentTarget();
      }, () => {
        const target = this.getCurrentTarget();
        return target && !target.hasAura('Sigil of Flame');
      }),
  
      // Metamorphosis
      spell.cast('Metamorphosis', on => me, () => {
        // Following APL logic for meta usage
        const cooldownEyeBeam = spell.getCooldown('Eye Beam').timeleft;
        const cooldownBladeDance = spell.getCooldown('Blade Dance').timeleft;
        const innerDemonDown = !me.hasAura('Inner Demon');
        const essenceBreakDebuff = this.getDebuffRemainingTime('Essence Break') > 0;
        
        const standardCondition = (
          ((cooldownEyeBeam >= 15000 || 
            (this.hasTalent('Cycle of Hatred') && cooldownEyeBeam >= 13000)) && 
            (!this.hasTalent('Essence Break') || essenceBreakDebuff) && 
            !me.hasAura('Fel Barrage') && 
            ((!this.hasTalent('Fel Barrage')) && 
            this.enemiesAroundMe(8) > 2))
        );
        
        const emergencyUse = !this.hasTalent('Chaotic Transformation') || this.fightRemains() < 30000;
        
        return ((standardCondition || emergencyUse) && 
          innerDemonDown && 
          (!this.hasTalent('Restless Hunter') && 
          cooldownBladeDance > 3000 || 
          this.getLastSuccessfulSpell() === 'Death Sweep')) && 
          this.getTimeSinceStart() > 15000;
      }),
      
      // Use The Hunt for damage and mobility
      spell.cast('The Hunt', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.getDebuffRemainingTime('Essence Break') <= 0 && 
          this.enemiesAroundMe(8) >= this.getDesiredTargets() &&
          !me.hasAura('Reaver\'s Glaive') &&
          (this.getAuraRemainingTime('Metamorphosis') > 5000 || !me.hasAura('Metamorphosis')) &&
          (!this.hasTalent('Initiative') || me.hasAura('Initiative') || this.getTimeSinceStart() > 5000) &&
          CombatTimer.getCombatTime() > 5000 &&
          (!this.hasTalent('Inertia') && !me.hasAura('Unbound Chaos') || !me.hasAura('Inertia Trigger'));
      }),
      
      // Vengeful Retreat for Initiative buff
      spell.cast('Vengeful Retreat', on => me, req => this.hasTalent('Initiative')),
      
      // Use Reavers Glaive when conditions are met
    spell.cast('Reaver\'s Glaive', target => {
      return this.getCurrentTarget();
    }, () => {
      const eyeBeamCD = spell.getCooldown('Eye Beam') ? spell.getCooldown('Eye Beam').timeleft : 0;
      
      return !me.hasAura('Glaive Flurry') && 
        !me.hasAura('Rending Strike') && 
        this.getAuraRemainingTime('Thrill of the Fight Damage') < 4000 && 
        (me.hasAura('Thrill of the Fight Damage') || 
        this.getLastSuccessfulSpell() !== 'Death Sweep') && 
        this.enemiesAroundMe(8) < 3 && 
        this.getDebuffRemainingTime('Essence Break') <= 0 && 
        (this.getAuraRemainingTime('Metamorphosis') > 2000 || 
        eyeBeamCD < 10000);
    }),
      
      // Essence Break for damage window
      spell.cast('Essence Break', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.getFury() > 20 && 
          (spell.getCooldown('Blade Dance').timeleft < 3000 || spell.getCooldown('Blade Dance').ready) &&
          (!this.hasTalent('Inertia') || me.hasAura('Inertia')) &&
          
          (!this.hasTalent('Shattered Destiny') || spell.getCooldown('Eye Beam').timeleft > 4000) ||
          this.fightRemains() < 10000;
      }),
      
      // Use Eye Beam
      spell.cast('Eye Beam', target => {
        return this.getCurrentTarget();
      }, () => {
        return (spell.getCooldown('Blade Dance').timeleft < 7000 ) ||
          this.fightRemains() < 10000;
      }),
      
      // Use Immolation Aura
      spell.cast('Immolation Aura', on => me, () => {
        // Simple condition for single target
        const immolationCD = spell.getCooldown('Immolation Aura');
        const eyeBeamCD = spell.getCooldown('Eye Beam');
        
        // Standard condition for A Fire Inside + Burning Wound build
        const standardCondition = me.hasAura('A Fire Inside') && 
          me.hasAura('Burning Wound');
        
        // Additional condition from APL
        const aoeCondition = this.enemiesAroundMe(8) > 2 && 
          this.hasTalent('Ragefire') &&
          (!this.hasTalent('Fel Barrage') || 
          !spell.getCooldown('Fel Barrage') || 
          (spell.getCooldown('Fel Barrage').timeleft > (immolationCD ? immolationCD.timeleft : 0))) &&
          this.getDebuffRemainingTime('Essence Break') <= 0 &&
          (!me.hasAura('Metamorphosis') || this.getAuraRemainingTime('Metamorphosis') > 5000);
        
        // Basic condition to ensure it's used in single target
        const basicCondition = (!immolationCD || immolationCD.ready) && 
          (!eyeBeamCD || eyeBeamCD.timeleft >= this.getGCD());
        
        return standardCondition || aoeCondition || basicCondition;
      }),
      
      // Use Death Sweep during Metamorphosis instead of Blade Dance
      spell.cast('Death Sweep', target => {
        return this.getCurrentTarget();
      }, () => {
        return me.hasAura('Metamorphosis') && 
          (this.getAuraRemainingTime('Metamorphosis') < this.getGCD() || 
          this.getDebuffRemainingTime('Essence Break') > 0 || 
          this.getLastSuccessfulSpell() === 'Metamorphosis');
      }),
      
      // Use Blade Dance
      spell.cast('Blade Dance', target => {
        return this.getCurrentTarget();
      }, () => {
        return spell.getCooldown('Eye Beam').timeleft >= this.getGCD() * 3 && 
          !me.hasAura('Rending Strike');
      }),
      
      // Sigil of Spite
      spell.cast('Sigil of Spite', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.getDebuffRemainingTime('Essence Break') <= 0 && 
          this.getDebuffRemainingTime('Reaver\'s Mark') >= 2 - (this.hasTalent('Quickened Sigils') ? 1 : 0);
      }),
  
      // Chaos Strike with Rending Strike buff
      spell.cast('Chaos Strike', target => {
        return this.getCurrentTarget();
      }, () => {
        return me.hasAura('Rending Strike');
      }),
      
      // Annihilation (Metamorphosis version of Chaos Strike)
      spell.cast('Annihilation', target => {
        return this.getCurrentTarget();
      }, () => {
        return me.hasAura('Metamorphosis') && 
          (spell.getCooldown('Blade Dance').timeleft > 0 || this.getFury() > 60 || 
          this.getSoulFragments() > 0 || this.getAuraRemainingTime('Metamorphosis') < 5000);
      }),
      
      // Chaos Strike during Essence Break
      spell.cast('Chaos Strike', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.getDebuffRemainingTime('Essence Break') > 0;
      }),
      
      // Felblade for Fury generation
      spell.cast('Felblade', target => {
        return this.getCurrentTarget();
      }, () => {
        // Calculate fury generation based on spell base info
        const furyGen = 30; // Base fury generation from Felblade
        return this.getFuryDeficit() >= 40 + (furyGen * 0.5) && 
          !me.hasAura('Inertia Trigger');
      }),

      // Continuing aldrachiSingleTarget
      
      // Glaive Tempest
      spell.cast('Glaive Tempest', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.enemiesAroundMe(8) >= this.getDesiredTargets();
      }),
      
      // Chaos Strike when high on Fury or Eye Beam is on CD
      spell.cast('Chaos Strike', target => {
        return this.getCurrentTarget();
      }, () => {
        return spell.getCooldown('Eye Beam').timeleft > this.getGCD() * 2 || this.getFury() > Settings.DHHavocFuryThreshold;
      }),
      
      // Immolation Aura (fallback)
      spell.cast('Immolation Aura', on => me, () => {
        return this.enemiesAroundMe(8) > this.getDesiredTargets() && this.enemiesAroundMe(8) > 2;
      }),
      
      // Sigil of Flame (fallback)
      spell.cast('Sigil of Flame', target => {
        return this.getCurrentTarget();
      }, () => {
        return !me.hasAura('Out of Range') && 
          this.getDebuffRemainingTime('Essence Break') <= 0 && 
          (!this.hasTalent('Fel Barrage') || 
          spell.getCooldown('Fel Barrage').timeleft > 25000 || 
          this.enemiesAroundMe(8) === 1);
      }),
      
      // Throw Glaive for AoE
      spell.cast('Throw Glaive', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.enemiesAroundMe(8) > 1 && 
          me.hasAura('Furious Throws') && 
          (!this.hasTalent('Screaming Brutality') || 
          spell.getCharges('Throw Glaive') === 2 || 
          this.getFullRechargeTime('Throw Glaive') < spell.getCooldown('Blade Dance').timeleft);
      }),
      
      // Fel Rush for mobility and AoE
      spell.cast('Fel Rush', target => {
        return this.getCurrentTarget();
      }, () => {
        return !me.hasAura('Unbound Chaos') && 
          spell.getCooldown('Fel Rush').timeleft < spell.getCooldown('Eye Beam').timeleft && 
          this.getDebuffRemainingTime('Essence Break') <= 0 && 
          (spell.getCooldown('Eye Beam').timeleft > 8000 || this.getChargesFractional('Fel Rush') > 1.01) &&
          this.enemiesAroundMe(8) > 1;
      }),
      
      // Arcane Torrent for resource
      spell.cast('Arcane Torrent', on => me, () => {
        return !me.hasAura('Out of Range') && 
          this.getDebuffRemainingTime('Essence Break') <= 0 && 
          this.getFury() < 100;
      }),
      
      // Demon's Bite as filler
      spell.cast('Demon\'s Bite', target => {
        return this.getCurrentTarget();
      })
    );
  }

  aldrachiAoe() {
    return new bt.Selector(
      // High priority Immolation Aura for AOE
      spell.cast('Immolation Aura', on => me, () => {
        return this.enemiesAroundMe(8) > 2 && 
          me.hasAura('Ragefire') && 
          (!me.hasAura('Fel Barrage') || 
          spell.getCooldown('Fel Barrage').timeleft > spell.getCooldown('Immolation Aura').timeleft) && 
          this.getDebuffRemainingTime('Essence Break') <= 0 && 
          (!me.hasAura('Metamorphosis') || this.getAuraRemainingTime('Metamorphosis') > 5000);
      }),
      
      // Immolation Aura for adds phase
      spell.cast('Immolation Aura', on => me, () => {
        return this.enemiesAroundMe(8) > 2 && 
          me.hasAura('Ragefire') && 
          this.getDebuffRemainingTime('Essence Break') <= 0;
      }),
      
      // Eye Beam for AOE
      spell.cast('Eye Beam', target => {
        return this.getCurrentTarget();
      }),
      
      // Blade Dance
      spell.cast('Blade Dance', target => {
        return this.getCurrentTarget();
      }),
      
      // Glaive Tempest
      spell.cast('Glaive Tempest', target => {
        return this.getCurrentTarget();
      }),
      
       // Sigil of Spite
      spell.cast('Sigil of Spite', target => {
        return this.getCurrentTarget();
      }),

      // Throw Glaive for AoE
      spell.cast('Throw Glaive', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.enemiesAroundMe(8) > 1 && me.hasAura('Furious Throws');
      }),
      
      // Sigil of Flame for AoE
      spell.cast('Sigil of Flame', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.enemiesAroundMe(8) > 3 || this.getDebuffRemainingTime('Essence Break') <= 0;
      }),
      
      // Immolation Aura
      spell.cast('Immolation Aura', on => me),
      
      // Fel Rush for mobility and AoE
      spell.cast('Fel Rush', target => {
        return this.getCurrentTarget();
      }, () => {
        return !me.hasAura('Unbound Chaos') && 
          spell.getCooldown('Fel Rush').timeleft < spell.getCooldown('Eye Beam').timeleft && 
          this.getDebuffRemainingTime('Essence Break') <= 0 && 
          this.enemiesAroundMe(8) > 1;
      }),
      
      // Chaos Strike with Rending Strike buff
      spell.cast('Chaos Strike', target => {
        return this.getCurrentTarget();
      }, () => {
        return me.hasAura('Rending Strike') && this.enemiesAroundMe(8) > 2;
      }),
      
      // Felblade for Fury generation
      spell.cast('Felblade', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.getFuryDeficit() >= 40 && !me.hasAura('Inertia Trigger');
      }),
      
      // Chaos Strike during Essence Break
      spell.cast('Chaos Strike', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.getDebuffRemainingTime('Essence Break') > 0;
      }),
      
      // Demon's Bite as filler
      spell.cast('Demon\'s Bite', target => {
        return this.getCurrentTarget();
      })
    );
  }

  handleFelBarrage() {
    return new bt.Decorator(
      req => me.hasAura('Fel Barrage') && (this.enemiesAroundMe(8) >= 3 || !me.hasAura('Demon Blades')),
      new bt.Selector(
        // High priority for Annihilation with Inner Demon
        spell.cast('Annihilation', target => {
          return this.getCurrentTarget();
        }, () => {
          return me.hasAura('Inner Demon');
        }),
        
        // Eye Beam
        spell.cast('Eye Beam', target => {
          return this.getCurrentTarget();
        }, () => {
          return !me.hasAura('Fel Barrage') && (this.enemiesAroundMe(8) > 1);
        }),
        
        // Essence Break
        spell.cast('Essence Break', target => {
          return this.getCurrentTarget();
        }, () => {
          return !me.hasAura('Fel Barrage') && me.hasAura('Metamorphosis');
        }),
        
        // Death Sweep
        spell.cast('Death Sweep', target => {
          return this.getCurrentTarget();
        }, () => {
          return !me.hasAura('Fel Barrage');
        }),
        
        // Immolation Aura
        spell.cast('Immolation Aura', on => me, () => {
          return (this.enemiesAroundMe(8) > 2 || me.hasAura('Fel Barrage')) && 
                (spell.getCooldown('Eye Beam').timeleft > spell.getCooldown('Immolation Aura').timeleft + 3000);
        }),
        
        // Glaive Tempest
        spell.cast('Glaive Tempest', target => {
          return this.getCurrentTarget();
        }, () => {
          return !me.hasAura('Fel Barrage') && this.enemiesAroundMe(8) > 1;
        }),
        
        // Blade Dance
        spell.cast('Blade Dance', target => {
          return this.getCurrentTarget();
        }, () => {
          return !me.hasAura('Fel Barrage');
        }),
        
        // Cast Fel Barrage
        spell.cast('Fel Barrage', target => {
          return this.getCurrentTarget();
        }, () => {
          return this.getFury() > 100;
        }),
        
        // Felblade with Inertia Trigger and Fel Barrage
        spell.cast('Felblade', target => {
          return this.getCurrentTarget();
        }, () => {
          return me.hasAura('Inertia Trigger') && me.hasAura('Fel Barrage');
        }),
        
        // Sigil of Flame
        spell.cast('Sigil of Flame', target => {
          return this.getCurrentTarget();
        }, () => {
          return this.getFuryDeficit() > 40 && me.hasAura('Fel Barrage');
        })
      )
    );
  }

  felScarred() {
    return new bt.Selector(
      // Handle different enemy counts
      new bt.Decorator(
        req => this.enemiesAroundMe(8) >= 3,
        new bt.Selector(
          this.felScarredCooldowns(),
          this.felScarredAoe()
        )
      ),
      
      new bt.Decorator(
        req => this.enemiesAroundMe(8) < 3,
        new bt.Selector(
          this.felScarredCooldowns(),
          this.felScarredSingleTarget()
        )
      )
    );
  }

  felScarredCooldowns() {
    return new bt.Selector(
      // Metamorphosis for Fel-Scarred
      spell.cast('Metamorphosis', on => me, () => {
        return this.useOffensiveCooldowns() && 
          ((spell.getCooldown('Eye Beam').timeleft >= 15000 && 
           (!me.hasAura('Essence Break') || this.getDebuffRemainingTime('Essence Break') > 0) && 
           !me.hasAura('Fel Barrage')) || 
           this.fightRemains() < 30000) && 
          !me.hasAura('Inner Demon') && 
          (!me.hasAura('Restless Hunter') || spell.getCooldown('Blade Dance').timeleft > 1500) && 
          !me.hasAura('Inertia') && 
          !me.hasAura('Essence Break') && 
          (this.getHeroTree() === 'aldrachi' || !me.hasAura('Demonsurge Death Sweep')) && 
          this.getTimeSinceStart() > 15000;
      }),
      
      // The Hunt for Fel-Scarred
      spell.cast('The Hunt', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.useOffensiveCooldowns() && 
          this.getDebuffRemainingTime('Essence Break') <= 0 && 
          (!me.hasAura('Initiative') || me.hasAura('Initiative')) && 
          this.getTimeSinceStart() > 5000 && 
          (!me.hasAura('Inertia') && !me.hasAura('Unbound Chaos') || !me.hasAura('Inertia Trigger')) && 
          (this.getHeroTree() === 'aldrachi' || !me.hasAura('Metamorphosis'));
      })
    );
  }

  felScarredSingleTarget() {
    return new bt.Selector(
      // Felblade with Unbound Chaos
      spell.cast('Felblade', target => {
        return this.getCurrentTarget();
      }, () => {
        return me.hasAura('Unbound Chaos') && 
          !me.hasAura('Inertia') && 
          this.enemiesAroundMe(8) <= 2 && 
          (me.hasAura('Student of Suffering') && 
          (spell.getCooldown('Eye Beam').timeleft - 3000) <= this.getAuraRemainingTime('Unbound Chaos'));
      }),
      
      // Sigil of Flame before Eye Beam
      spell.cast('Sigil of Flame', target => {
        return this.getCurrentTarget();
      }, () => {
        return me.hasAura('Student of Suffering') && 
          spell.getCooldown('Eye Beam').timeleft <= this.getGCD() && 
          (spell.getCooldown('Essence Break').timeleft < 1500 || 
          !me.hasAura('Essence Break'));
      }),
      
      // Eye Beam
      spell.cast('Eye Beam', target => {
        return this.getCurrentTarget();
      }, () => {
        return (!me.hasAura('Initiative') || 
          me.hasAura('Initiative') || 
          spell.getCooldown('Vengeful Retreat').timeleft >= 10000) && 
          (spell.getCooldown('Blade Dance').timeleft < 7000);
      }),
      
      // Blade Dance
      spell.cast('Blade Dance', target => {
        return this.getCurrentTarget();
      }, () => {
        return spell.getCooldown('Eye Beam').timeleft >= 6000 || 
          this.getDebuffRemainingTime('Essence Break') > 0;
      }),
      
      // Immolation Aura
      spell.cast('Immolation Aura', on => me, () => {
        return me.hasAura('A Fire Inside') && 
          me.hasAura('Isolated Prey') && 
          me.hasAura('Flamebound') && 
          this.enemiesAroundMe(8) === 1 && 
          spell.getCooldown('Eye Beam').timeleft >= this.getGCD();
      }),
      
      // Felblade
      spell.cast('Felblade', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.getFuryDeficit() > 40 && 
          spell.getCooldown('Metamorphosis').timeleft > 0 && 
          spell.getCooldown('Eye Beam').timeleft >= 500;
      }),
      
      // Chaos Strike
      spell.cast('Chaos Strike', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.getDebuffRemainingTime('Essence Break') > 0 ||
          spell.getCooldown('Eye Beam').timeleft >= 6000 || 
          this.getFury() >= 70;
      }),
      
      // Immolation Aura
      spell.cast('Immolation Aura', on => me, () => {
        return spell.getCooldown('Eye Beam').timeleft >= this.getGCD();
      }),
      
      // Fel Rush
      spell.cast('Fel Rush', target => {
        return this.getCurrentTarget();
      }, () => {
        return !me.hasAura('Unbound Chaos') && 
          spell.getCooldown('Fel Rush').timeleft < spell.getCooldown('Eye Beam').timeleft && 
          this.getDebuffRemainingTime('Essence Break') <= 0 && 
          this.enemiesAroundMe(8) > 1;
      }),
      
      // Throw Glaive
      spell.cast('Throw Glaive', target => {
        return this.getCurrentTarget();
      }, () => {
        return spell.getCooldown('Throw Glaive').timeleft < spell.getCooldown('Eye Beam').timeleft && 
          this.getDebuffRemainingTime('Essence Break') <= 0 && 
          this.enemiesAroundMe(8) > 1;
      }),
      
      // Demon's Bite as filler
      spell.cast('Demon\'s Bite', target => {
        return this.getCurrentTarget();
      })
    );
  }

  felScarredAoe() {
    return new bt.Selector(
      // Sigil of Flame before Eye Beam
      spell.cast('Sigil of Flame', target => {
        return this.getCurrentTarget();
      }, () => {
        return me.hasAura('Student of Suffering') && 
          spell.getCooldown('Eye Beam').timeleft <= this.getGCD();
      }),
      
      // Eye Beam prioritized for AoE
      spell.cast('Eye Beam', target => {
        return this.getCurrentTarget();
      }),
      
      // Immolation Aura
      spell.cast('Immolation Aura', on => me, () => true),
      
      // Blade Dance
      spell.cast('Blade Dance', target => {
        return this.getCurrentTarget();
      }),
      
      // Glaive Tempest
      spell.cast('Glaive Tempest', target => {
        return this.getCurrentTarget();
      }),
      
      // Fel Rush with Unbound Chaos
      spell.cast('Fel Rush', target => {
        return this.getCurrentTarget();
      }, () => {
        return me.hasAura('Unbound Chaos');
      }),
      
      // Throw Glaive for AoE
      spell.cast('Throw Glaive', target => {
        return this.getCurrentTarget();
      }),
      
      // Chaos Strike during Essence Break
      spell.cast('Chaos Strike', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.getDebuffRemainingTime('Essence Break') > 0;
      }),
      
      // Felblade for Fury generation
      spell.cast('Felblade', target => {
        return this.getCurrentTarget();
      }, () => {
        return this.getFuryDeficit() > 40;
      }),
      
      // Fel Rush for mobility and AoE damage
      spell.cast('Fel Rush', target => {
        return this.getCurrentTarget();
      }, () => {
        return !me.hasAura('Unbound Chaos') && this.enemiesAroundMe(8) > 1;
      }),
      
      // Demon's Bite as filler
      spell.cast('Demon\'s Bite', target => {
        return this.getCurrentTarget();
      })
    );
  }

  defensiveCooldowns() {
    return new bt.Selector(
      // Blur
      spell.cast('Blur', on => me, () => 
        me.pctHealth <= Settings.DHHavocBlurThreshold && 
        this.useDefensiveCooldowns()),
      
      // Darkness
      spell.cast('Darkness', on => me, () => 
        me.pctHealth <= Settings.DHHavocBlurThreshold - 10 && 
        this.useDefensiveCooldowns()),
      
      // Netherwalk
      spell.cast('Netherwalk', on => me, () => 
        me.pctHealth <= Settings.DHHavocBlurThreshold - 15 && 
        spell.isSpellKnown('Netherwalk') && 
        this.useDefensiveCooldowns())
    );
  }

  // Utility methods
  hasTalent(talentName) {
    return me.hasAura(talentName);
  }

  useDefensiveCooldowns() {
    return Settings.DHHavocUseDefensiveCooldown;
  }

  useOffensiveCooldowns() {
    return Settings.DHHavocUseOffensiveCooldown;
  }

  getHeroTree() {
    return Settings.DHHavocHeroTree;
  }

  getFury() {
    return me.powerByType(PowerType.Fury);
  }
  
  getFuryDeficit() {
    // Maximum Fury is typically 120, but can be modified by talents
    const maxFury = 120; 
    return maxFury - this.getFury();
  }

  getActiveDotCount(dotName) {
    return combat.targets.filter(unit => unit.hasAura(dotName)).length;
  }

  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isFacing(unit) && target.distanceTo(unit) <=20;
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

  // getDebuffRemainingTime(debuffName) {
  //   const target = this.getCurrentTarget();
  //   if (!target) return 0;
  //   const debuff = target.getAura(debuffName);
  //   return debuff ? debuff.remaining : 0;
  // }
  getDebuffRemainingTime(debuffName) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    const debuff = target.getAura(debuffName);
    return debuff ? debuff.remaining : 0;
  }


  getGCD() {
    // Get the base GCD value (usually 1.5s without haste)
    return 1500 / (1 + (me.modSpellHaste / 100));
  }
  
  getTimeSinceStart() {
    return CombatTimer.getCombatTime() || 0;
  }

  enemiesAroundMe(range) {
    return me.getUnitsAroundCount(range);
  }

  enemiesAroundTarget(range) {
    const target = this.getCurrentTarget();
    return target ? target.getUnitsAroundCount(range) : 0;
  }
  
  isMetamorphosisActive() {
    return me.hasAura('Metamorphosis');
  }
  
  hasDemonsurgeStacks(minStacks = 3) {
    const aura = me.getAura('Demonsurge');
    return aura && aura.stacks >= minStacks;
  }
  
  hasUnboundChaos() {
    return me.hasAura('Unbound Chaos');
  }
  
  shouldUseInitiative() {
    return me.hasAura('Initiative') || this.getTimeSinceStart() > 5000;
  }
  
  isAoESituation() {
    return this.enemiesAroundMe(8) >= 3;
  }
  
  getSoulFragments() {
    return me.soulFragments || 0;
  }
  
  fightRemains() {
    const target = this.getCurrentTarget();
    return target ? target.timeToDeath() : 0;
  }

  /**
   * Gets the name of the last successfully cast spell
   * @returns {string} - The name of the last successfully cast spell
   */
  getLastSuccessfulSpell() {
    const lastSpell = spell.getLastSuccessfulSpell();
    return lastSpell ? lastSpell.spellName : '';
  }
  
  /**
   * Gets the full recharge time for a spell with charges
   * @param {string} spellName - The name of the spell
   * @returns {number} - The time in milliseconds until all charges are restored
   */
  getFullRechargeTime(spellName) {
    const cooldown = spell.getCooldown(spellName);
    if (!cooldown) return 0;
    
    // Return cooldown time remaining for the spell
    return cooldown.timeleft || 0;
  }
  /**
 * Checks if a spell will be ready soon (within 3 seconds)
 * @param {string} spellName - The name of the spell
 * @returns {boolean} - Whether the spell is ready or will be ready soon
 */
isSpellReadySoon(spellName) {
  const cooldown = spell.getCooldown(spellName);
  if (!cooldown || cooldown.ready) return true;
  return cooldown.timeleft < 3000;
}
  /**
 * Gets the maximum number of charges for a spell
 * @param {string} spellName - The name of the spell
 * @returns {number} - The maximum number of charges
 */
getMaxCharges(spellName) {
  const spellObj = spell.getSpell(spellName);
  if (!spellObj || !spellObj.charges) return 1;
  return spellObj.charges.maxCharges || 1;
}
  
  /**
   * Gets the current charges of a spell including fractional part
   * @param {string} spellName - The name of the spell
   * @returns {number} - The charges with decimal portion
   */
  getChargesFractional(spellName) {
    const cooldown = spell.getCooldown(spellName);
    const charges = spell.getCharges(spellName);
    
    if (!cooldown || cooldown.ready) return charges;
    
    // Add fractional part based on cooldown progress
    const fractionalCharge = 1 - (cooldown.timeleft / cooldown.duration);
    return charges + fractionalCharge;
  }

  /**
   * Determines the optimal number of targets for AoE abilities based on talents, gear, and context
   * @returns {number} The threshold number of targets that makes AoE abilities more efficient
   */
  getDesiredTargets() {
    // Base target threshold - most AoE abilities become better at 2-3 targets
    let baseTargets = 2;
    
    // Adjust based on talents
    if (this.hasTalent('Furious Throws')) {
      // Furious Throws makes Throw Glaive more efficient at 2+ targets
      baseTargets = Math.min(baseTargets, 2);
    }
    
    if (this.hasTalent('Ragefire')) {
      // Ragefire makes Immolation Aura more efficient in multi-target
      baseTargets = Math.min(baseTargets, 2);
    }
    
    if (this.hasTalent('Soulscar') && this.hasTalent('Fel Barrage')) {
      // These talents together make AoE abilities more valuable
      baseTargets = Math.min(baseTargets, 2);
    }
    
    // Final target count, with a minimum of 2 to avoid being too conservative
    return Math.max(2, baseTargets);
  }

  trackLastSpellCast() {
    const lastSpell = spell.getLastSuccessfulSpell();
    if (lastSpell ) {
      // Make sure lastSpells is initialized if it's null
      if (this._lastSpells === null) {
        // Since lastSpells is a const in your script, we need to modify it differently
        // We'll reassign its value using Object.defineProperty if needed
        Object.defineProperty(window, 'lastSpells', {
          value: new Array(5).fill(''),
          writable: true,
          configurable: true
        });
      }
      
      // Shift existing spells to make room for the new one at index 0
      for (let i = this._lastSpells.length - 1; i > 0; i--) {
        this._lastSpells[i] = this._lastSpells[i - 1];
      }
      this._lastSpells[0] = lastSpell;
    }
  }
  
  /**
   * Check if Vengeful Retreat was cast within the last specified number of spells
   * @param {number} lookbackDepth - How many spells back to look (default: 2)
   * @returns {boolean} - Whether Vengeful Retreat was found in the history
   */
  wasVengefulRetreatCastRecently(lookbackDepth = 2) {
    // Update the history with the most recent spell
    this.trackLastSpellCast();
    
    // Make sure lastSpells is not null before checking it
    if (this._lastSpells === null) {
      return false;
    }

    if (this._lastSpells.length < 0) {
      return false;
    }
    // console.debug("=== STORED SPELLS ===");
    // for (let i = 0; i < lookbackDepth; i++) {
    //  console.debug(this._lastSpells[i]);
    // }
    // Check the history up to the specified depth
    const depth = Math.min(lookbackDepth, this._lastSpells.length);
    for (let i = 0; i < depth; i++) {
      if (this._lastSpells[i] === 'Vengeful Retreat') {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Check if we should use Fel Rush after Vengeful Retreat
   * @returns {boolean} - Whether we should use Fel Rush
   */
  shouldUseFelRushAfterVengefulRetreat() {
    return this.wasVengefulRetreatCastRecently(2);
  }

  /**
   * Initializes the behavior with a start time
   * @override
   */
  onInitialize() {
    this.startTime = performance.now();
  }
}