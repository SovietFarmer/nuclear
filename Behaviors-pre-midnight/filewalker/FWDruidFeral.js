import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";

export class DruidFeralBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Druid.Feral;
  name = "SimC Feral Druid";
  
  // Static aura IDs
  static auras = {
    // General Druid
    aessinas_renewal: 474678,
    astral_influence: 197524,
    blooming_infusion: 429433,
    bounteous_bloom: 429215,
    cenarius_might: 455797,
    circle_of_the_heavens: 474541,
    circle_of_the_wild: 474530,
    control_of_the_dream: 434249,
    cyclone: 33786,
    dream_surge: 433831,
    durability_of_nature: 429227,
    early_spring: 428937,
    expansiveness: 429399,
    feline_swiftness: 131768,
    fluid_form: 449193,
    forestwalk: 400129,
    frenzied_regeneration: 22842,
    gale_winds: 400142,
    grievous_wounds: 474526,
    groves_inspiration: 429402,
    harmony_of_the_grove: 428731,
    heart_of_the_wild: 319454,
    hibernate: 2637,
    improved_barkskin: 327993,
    improved_stampeding_roar: 288826,
    incapacitating_roar: 99,
    incessant_tempest: 400140,
    innervate: 29166,
    instincts_of_the_claw: 449184,
    ironfur: 192081,
    killer_instinct: 108299,
    lingering_healing: 231040,
    lore_of_the_grove: 449185,
    lycaras_meditation: 474728,
    lycaras_teachings: 378988,
    maim: 22570,
    mass_entanglement: 102359,
    matted_fur: 385786,
    mighty_bash: 5211,
    moonkin_form: 24858,
    natural_recovery: 377796,
    natures_vigil: 124974,
    nurturing_instinct: 33873,
    oakskin: 449191,
    perfectlyhoned_instincts: 1213597,
    potent_enchantments: 429420,
    power_of_nature: 428859,
    power_of_the_dream: 434220,
    primal_fury: 159286,
    protective_growth: 433748,
    rake: 1822,
    rejuvenation: 774,
    remove_corruption: 2782,
    renewal: 108238,
    rip: 1079,
    skull_bash: 106839,
    soothe: 2908,
    stampeding_roar: 106898,
    starfire: 197628,
    starlight_conduit: 451211,
    starsurge: 197626,
    sunfire: 93402,
    symbiotic_relationship: 474750,
    thick_hide: 16931,
    thrash: 106832,
    tiger_dash: 252216,
    treants_of_the_moon: 428544,
    typhoon: 132469,
    ursine_vigor: 377842,
    ursocs_spirit: 449182,
    ursols_vortex: 102793,
    verdant_heart: 301768,
    wellhoned_instincts: 377847,
    wild_charge: 102401,
    wild_growth: 48438,
    
    // Feral specific
    adaptive_swarm: 391888,
    apex_predators_craving: 391881,
    ashamanes_guidance: 391548,
    berserk: 106951,
    berserk_frenzy: 384668,
    berserk_heart_of_the_lion: 391174,
    bloodtalons: 319439,
    brutal_slash: 202028,
    carnivorous_instinct: 390902,
    circle_of_life_and_death: 400320,
    coiled_to_spring: 449537,
    convoke_the_spirits: 391528,
    doubleclawed_rake: 391700,
    dreadful_bleeding: 391045,
    feral_frenzy: 274837,
    frantic_momentum: 391875,
    incarnation: 102543,
    incarnation_avatar_of_ashamane: 102543,
    infected_wounds: 48484,
    lions_strength: 391972,
    lunar_inspiration: 155580,
    merciless_claws: 231063,
    moment_of_clarity: 236068,
    omen_of_clarity: 16864,
    pouncing_strikes: 390772,
    predator: 202021,
    predatory_swiftness: 16974,
    primal_wrath: 285381,
    raging_fury: 391078,
    rampant_ferocity: 391709,
    rip_and_tear: 391347,
    saber_jaws: 421432,
    sabertooth: 202031,
    savage_fury: 449645,
    soul_of_the_forest: 158476,
    sudden_ambush: 384667,
    survival_instincts: 61336,
    taste_for_blood: 384665,
    thrashing_claws: 405300,
    tigers_fury: 5217,
    tigers_tenacity: 391872,
    tireless_energy: 383352,
    unbridled_swarm: 391951,
    veinripper: 391978,
    wild_slashes: 390864,
    
    // Druid of the Claw
    aggravate_wounds: 441829,
    bestial_strength: 441841,
    claw_rampage: 441835,
    dreadful_wound: 441809,
    empowered_shapeshifting: 441689,
    fount_of_strength: 441675,
    killing_strikes: 441824,
    packs_endurance: 441844,
    ravage: 441583,
    ruthless_aggression: 441814,
    strike_for_the_heart: 441845,
    tear_down_the_mighty: 441846,
    wildpower_surge: 441691,
    wildshape_mastery: 441678,
    
    // Wildstalker
    bond_with_nature: 439929,
    bursting_growth: 440120,
    entangling_vortex: 439895,
    flower_walk: 439901,
    harmonious_constitution: 440116,
    hunt_beneath_the_open_skies: 439868,
    implant: 440118,
    lethal_preservation: 455461,
    resilient_flourishing: 439880,
    root_network: 439882,
    strategic_infusion: 439890,
    thriving_growth: 439528,
    twin_sprouts: 440117,
    vigorous_creepers: 440119,
    wildstalkers_power: 439926
  };

  // Settings
  static settings = [
    {
      header: "Feral Settings",
      options: [
        {
          uid: "regrowth",
          text: "Use Regrowth for healing",
          type: "checkbox",
          default: false
        },
        {
          uid: "easy_swipe",
          text: "Use Swipe more frequently in AoE (less Shred)",
          type: "checkbox",
          default: false
        }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      new bt.Action(() => {
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      common.waitForCastOrChannel(),
    //   this.precombat(),
      spell.cast("Prowl", () => !me.inCombat() && !me.hasAura("Prowl")),
      spell.cast("Cat Form", () => !me.hasAura("Cat Form") && !this.hasTalent("Fluid Form")),
      spell.cast("Skull Bash", () => this.getCurrentTarget() && this.getCurrentTarget().isCasting),
      spell.cast("Soothe", () => this.getCurrentTarget() && this.getCurrentTarget().hasEnrageEffect),
      this.variables(),
      
      // Tigers Fury
      spell.cast("Tiger's Fury", () => {
        const currentTarget = this.getCurrentTarget();
        return (me.powerByType(PowerType.Energy) > 35 || 
                 me.powerByType(PowerType.ComboPoints) == 5 || 
                ( me.powerByType(PowerType.ComboPoints) >= 3 && this.isDoTRefreshable("Rip", currentTarget) && me.hasAura("Bloodtalons"))) && 
               (this.getFightRemains() <= 15 || 
                (spell.getCooldown("Berserk").timeleft > 20 && this.getFightRemains() > 5) || 
                (spell.getCooldown("Berserk").ready && this.getFightRemains() > 12));
      }),
      
      // Rake from stealth
      spell.cast("Rake", () => me.hasAura("Shadowmeld") || me.hasAura("Prowl")),
      
      // Nature's Vigil and Renewal for healing
      spell.cast("Nature's Vigil", () => this.getVariable("regrowth") && me.pctHealth < 70 && (me.hasAura("Berserk") || me.hasAura("Tiger's Fury"))),
      spell.cast("Renewal", () => this.getVariable("regrowth") && me.pctHealth < 70),
      
      // Adaptive Swarm
      spell.cast("Adaptive Swarm", on => this.getAdaptiveSwarmTarget(), req => {
        const target = this.getAdaptiveSwarmTarget();
        return target && 
               target.getAuraStacks("Adaptive Swarm Damage") < 3 && 
               (!target.hasAura("Adaptive Swarm Damage") || target.getAuraRemainingTime("Adaptive Swarm Damage") < 2) && 
            //    !spell.isInFlight("Adaptive Swarm") && 
               (this.getEnemiesInRange(8) == 1 || !this.hasTalent("Unbridled Swarm")) && 
               (target.hasAura("Rip") || this.hasHeroTalent("Druid of the Claw"));
      }),
      
      // Adaptive Swarm for AoE
      spell.cast("Adaptive Swarm", on => this.getAdaptiveSwarmAoETarget(), req => {
        const target = this.getAdaptiveSwarmAoETarget();
        return me.hasAura("Cat Form") && 
               target && 
               target.getAuraStacks("Adaptive Swarm Damage") < 3 && 
               this.hasTalent("Unbridled Swarm") && 
               this.getEnemiesInRange(8) > 1 && 
               target.hasAura("Rip");
      }),
      
      // High priority - Ferocious Bite if Apex proc
      spell.cast("Ferocious Bite", on => this.getCurrentTarget(), req => {
        return me.hasAura("Apex Predator's Craving") && 
               !(this.getVariable("need_bt") && this.getActiveBtTriggers() == 2);
      }),
      
      // Call the appropriate action lists
      new bt.Decorator(
        () => this.getCurrentTarget() && this.getCurrentTarget().hasAura("Rip"),
        this.cooldown(),
        new bt.Action(() => bt.Status.Failure)
      ),
      
      // Handle Veinripper specific Rip logic
      spell.cast("Rip", on => this.getCurrentTarget(), req => {
        const target = this.getCurrentTarget();
        return this.hasTalent("Veinripper") && 
               this.getEnemiesInRange(8) == 1 && 
               this.hasHeroTalent("Wildstalker") && 
               !(this.hasTalent("Raging Fury") && this.hasTalent("Veinripper")) && 
               (me.hasAura("Bloodtalons") || !this.hasTalent("Bloodtalons")) && 
               ((this.isDoTRefreshable("Rip", target) && me.hasAura("Tiger's Fury") && target.getAuraRemainingTime("Tiger's Fury") > 10 &&  me.powerByType(PowerType.ComboPoints) >= 3) || 
                (((me.hasAura("Tiger's Fury") && target.getAuraRemainingTime("Tiger's Fury") < 3 &&  me.powerByType(PowerType.ComboPoints) == 5) || 
                  target.getAuraRemainingTime("Tiger's Fury") <= 1) && 
                 me.hasAura("Tiger's Fury") && 
                  me.powerByType(PowerType.ComboPoints) >= 3 && 
                 target.getAuraRemainingTime("Rip") < spell.getCooldown("Tiger's Fury").timeleft));
      }),
      
      // Non-Veinripper Rip logic
      spell.cast("Rip", on => this.getCurrentTarget(), req => {
        const target = this.getCurrentTarget();
        return !this.hasTalent("Veinripper") && 
               this.getEnemiesInRange(8) == 1 && 
               this.hasHeroTalent("Wildstalker") && 
               me.hasAura("Tiger's Fury") && 
               (me.hasAura("Bloodtalons") || !this.hasTalent("Bloodtalons")) && 
               ( me.powerByType(PowerType.ComboPoints) >= 3 && 
                this.isDoTRefreshable("Rip", target) && 
                spell.getCooldown("Tiger's Fury").timeleft > 25 || 
                me.hasAura("Tiger's Fury") && 
                target.getAuraRemainingTime("Tiger's Fury") < 5 && 
                this.getVariable("rip_duration") > spell.getCooldown("Tiger's Fury").timeleft && 
                spell.getCooldown("Tiger's Fury").timeleft >= target.getAuraRemainingTime("Rip"));
      }),
      
      // Finisher at 5 combo points
      new bt.Decorator(
        () => me.powerByType(PowerType.ComboPoints) == 5,
        this.finisher(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Single target builder
      new bt.Decorator(
        () => this.getEnemiesInRange(8) == 1 && 
              (this.getVariable("time_to_pool") <= 0 || 
              !this.getVariable("need_bt") || 
              this.getVariable("proccing_bt")) && 
               me.powerByType(PowerType.ComboPoints) < 5,
        this.builder(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // AoE builder
      new bt.Decorator(
        () => this.getEnemiesInRange(8) >= 2 && 
               me.powerByType(PowerType.ComboPoints) < 5 && 
              (this.getVariable("time_to_pool") <= 0 || 
              !this.getVariable("need_bt") || 
              this.getVariable("proccing_bt")),
        this.aoeBuilder(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Regrowth with Predatory Swiftness
      spell.cast("Regrowth", on => me, req => {
        return me.hasAura("Predatory Swiftness") && 
               this.getVariable("regrowth");
      })
    );
  }


// Precombat actions
precombat() {
    return new bt.Selector(
      spell.cast("Mark of the Wild", () => !me.hasAura("Mark of the Wild")),
      spell.cast("Prowl", () => !me.hasAura("Prowl")),
      spell.cast("Cat Form", () => !me.hasAura("Cat Form"))
      // Trinket variable calculations are handled in variables() method
    );
  }

  // Calculate and set variables
  variables() {
    return new bt.Action(() => {
      // Calculate rip duration
      const baseRipDuration = 4 + (4 *  me.powerByType(PowerType.ComboPoints));
      const circleModifier = this.hasTalent("Circle of Life and Death") ? 0.8 : 1;
      const veinripperModifier = this.hasTalent("Veinripper") ? 1.25 : 1;
      this.setVariable("rip_duration", baseRipDuration * circleModifier * veinripperModifier);
      
      // Calculate max pandemic duration (30% of full duration)
      this.setVariable("rip_max_pandemic_duration", this.getVariable("rip_duration") * 0.3);
      
      // Calculate effective energy
      const cleansingEnergy = 40 * me.getAuraStacks("Clearcasting");
      const regenEnergy = 3 * me.energyRegen;
      const tigersFuryEnergy = spell.getCooldown("Tiger's Fury").timeleft < 3.5 ? 50 : 0;
      this.setVariable("effective_energy", me.powerByType(PowerType.Energy) + cleansingEnergy + regenEnergy + tigersFuryEnergy);
      
      // Calculate time to pool
      const energyNeeded = 115 - this.getVariable("effective_energy") - (23 * (me.hasAura("Incarnation") ? 1 : 0));
      this.setVariable("time_to_pool", Math.max(0, energyNeeded / me.energyRegen));
      
      // Check if dot refresh is needed soon
      const thrashRefreshSoon = !this.hasTalent("Thrashing Claws") && 
                               (this.getDoTRemainingTime("Thrash") - this.getDoTDuration("Thrash") * 0.3 <= 2);
      const moonfireRefreshSoon = this.hasTalent("Lunar Inspiration") && 
                                 (this.getDoTRemainingTime("Moonfire") - this.getDoTDuration("Moonfire") * 0.3 <= 2);
      const rakeRefreshSoon = (me.hasAura("Rake") && this.getDoTPMultiplier("Rake") < 1.6 || me.hasAura("Sudden Ambush")) && 
                             (this.getDoTRemainingTime("Rake") - this.getDoTDuration("Rake") * 0.3 <= 2);
      this.setVariable("dot_refresh_soon", thrashRefreshSoon || moonfireRefreshSoon || rakeRefreshSoon);
      
      // Check if we need to proc Bloodtalons
      this.setVariable("need_bt", this.hasTalent("Bloodtalons") && me.getAuraStacks("Bloodtalons") <= 1);
      
      // Check if Clearcasting is capped
      const maxCC = 1 + (this.hasTalent("Moment of Clarity") ? 1 : 0);
      this.setVariable("cc_capped", me.getAuraStacks("Clearcasting") == maxCC);
      
      // Check if this is the last Convoke/Berserk cast
      const convokeCDRemains = spell.getCooldown("Convoke the Spirits").timeleft;
      const convokeCDDuration = spell.getCooldown("Convoke the Spirits").duration;
      const berserkCDRemains = spell.getCooldown("Berserk").timeleft;
      const berserkCDDuration = spell.getCooldown("Berserk").duration;
      const fightRemains = this.getFightRemains();
      
      this.setVariable("lastconvoke", (convokeCDRemains + convokeCDDuration) > fightRemains && convokeCDRemains < fightRemains);
      this.setVariable("lastzerk", (berserkCDRemains + berserkCDDuration + 5) > fightRemains && berserkCDRemains < fightRemains);
      
      // Use regrowth from settings
      this.setVariable("regrowth", this.getSetting("regrowth"));
      
      // Use easy swipe from settings
      this.setVariable("easy_swipe", this.getSetting("easy_swipe"));
      
      // Set proccing_bt
      this.setVariable("proccing_bt", this.getVariable("need_bt"));
      
      return bt.Status.Failure;
    });
  }

  // Variable getters and setters
  getVariable(name) {
    if (!this._variables) {
      this._variables = {};
    }
    return this._variables[name];
  }

  setVariable(name, value) {
    if (!this._variables) {
      this._variables = {};
    }
    this._variables[name] = value;
  }
  
  getSetting(name) {
    // Check if the setting exists in the Settings object
    return false;
  }

  // Cooldown usage
  cooldown() {
    return new bt.Selector(
      // Incarnation
      spell.cast("Incarnation", on => this.getCurrentTarget(), req => {
        return this.getFightRemains() > 17 || this.isBossTarget();
      }),
      
      // Use on-use damage trinkets
      new bt.Action(() => {
        if (this.hasTrinketDamage(1) && (!this.hasTrinketBuffs(2) || spell.getCooldown("Trinket2").timeleft > 20)) {
          common.useEquippedItemByName("Trinket1");
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      
      new bt.Action(() => {
        if (this.hasTrinketDamage(2) && (!this.hasTrinketBuffs(1) || spell.getCooldown("Trinket1").timeleft > 20)) {
          common.useEquippedItemByName("Trinket2");
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      
      // Berserk with Tiger's Fury
      spell.cast("Berserk", req => {
        return me.hasAura("Tiger's Fury") && (this.getFightRemains() > 12 || this.isBossTarget());
      }),
      
      // Racial - Berserking
      spell.cast("Berserking", req => me.hasAura("Berserk")),
      
    //   // Potion usage
    //   new bt.Action(() => {
    //     const shouldUsePotion = me.hasAura("Berserk") || 
    //                           (this.isBossTarget() && this.getFightRemains() < 32) || 
    //                           (!this.getVariable("lastzerk") && this.getVariable("lastconvoke") && 
    //                            spell.getCooldown("Convoke the Spirits").timeleft < 10);
        
    //     if (shouldUsePotion) {
    //       // Use potion - would need actual implementation
    //       return bt.Status.Success;
    //     }
    //     return bt.Status.Failure;
    //   }),
      
      // Use non-trinket gear items
      new bt.Action(() => {
        // This would need specific implementation depending on the gear
        return bt.Status.Failure;
      }),
      
    //   // Use Trinket 1 with buffs
    //   new bt.Action(() => {
    //     const useTrinket1 = this.hasTrinketBuffs(1) && 
    //                       (me.hasAura("Berserk") || 
    //                       ((me.hasAura("Tiger's Fury") && spell.getCooldown("Tiger's Fury").timeleft > 25) && 
    //                       (spell.getCooldown("Convoke the Spirits").timeleft < 6 || 
    //                       (this.hasTrinketBuffs(2) && spell.getCooldown("Convoke the Spirits").timeleft - spell.getCooldown("Trinket2").timeleft > 0) || 
    //                       !this.hasTalent("Convoke the Spirits") && spell.getCooldown("Berserk").timeleft - spell.getCooldown("Trinket2").timeleft > 0))) && 
    //                       (!this.hasTrinketCooldown(2) || spell.getCooldown("Trinket2").timeleft || this.getTrinketPriority() == 1) || 
    //                       this.getTrinketDuration(1) >= this.getFightRemains() && this.isBossTarget();
        
    //     if (useTrinket1) {
    //       common.useEquippedItemByName("Trinket1");
    //       return bt.Status.Success;
    //     }
    //     return bt.Status.Failure;
    //   }),
      
    //   // Use Trinket 2 with buffs
    //   new bt.Action(() => {
    //     const useTrinket2 = this.hasTrinketBuffs(2) && 
    //                       (me.hasAura("Berserk") || 
    //                       ((me.hasAura("Tiger's Fury") && spell.getCooldown("Tiger's Fury").timeleft > 25) && 
    //                       (spell.getCooldown("Convoke the Spirits").timeleft < 6 || 
    //                       (this.hasTrinketBuffs(1) && spell.getCooldown("Convoke the Spirits").timeleft - spell.getCooldown("Trinket1").timeleft > 0) || 
    //                       !this.hasTalent("Convoke the Spirits") && spell.getCooldown("Berserk").timeleft - spell.getCooldown("Trinket1").timeleft > 0))) && 
    //                       (!this.hasTrinketCooldown(1) || spell.getCooldown("Trinket1").timeleft || this.getTrinketPriority() == 2) || 
    //                       this.getTrinketDuration(2) >= this.getFightRemains() && this.isBossTarget();
        
    //     if (useTrinket2) {
    //       common.useEquippedItemByName("Trinket2");
    //       return bt.Status.Success;
    //     }
    //     return bt.Status.Failure;
    //   }),
      
      // Feral Frenzy
      spell.cast("Feral Frenzy", on => this.getCurrentTarget(), req => {
        return  me.powerByType(PowerType.ComboPoints) <= 1 + (me.hasAura("Berserk") ? 1 : 0) && 
               (me.hasAura("Tiger's Fury") || !this.hasTalent("Savage Fury") || !this.hasHeroTalent("Wildstalker") || 
               (this.isBossTarget() && this.getFightRemains() < spell.getCooldown("Tiger's Fury").timeleft));
      }),
      
      // Convoke the Spirits
      spell.cast("Convoke the Spirits", on => this.getCurrentTarget(), req => {
        return ((spell.getCooldown("Berserk").timeleft > 45 || me.hasAura("Berserk") || !this.hasTalent("Berserk Heart of the Lion")) && 
               (me.hasAura("Tiger's Fury") && ( me.powerByType(PowerType.ComboPoints) <= 4 || me.hasAura("Berserk") &&  me.powerByType(PowerType.ComboPoints) <= 3) && 
               (this.getTargetTimeToDie() > 5 - (this.hasTalent("Ashamane's Guidance") ? 1 : 0) || this.isBossTarget())));
      })
    );
  }

  // Finisher actions
  finisher() {
    return new bt.Selector(
      // Primal Wrath in AoE
      spell.cast("Primal Wrath", req => {
        const targets = this.getEnemiesInRange(8);
        
        return targets > 1 && 
               ((this.getPrimalWrathRemaining() < 6.5 && !me.hasAura("Berserk") || this.isPrimalWrathRefreshable()) || 
               (!this.hasTalent("Rampant Ferocity") && 
               (targets > 1 && !this.hasDebuff("Bloodseeker Vines") && !me.hasAura("Ravage") || 
               targets > 6 + (this.hasTalent("Ravage") ? 1 : 0))));
      }),
      
      // Rip single target or first target in AoE
      spell.cast("Rip", on => this.getCurrentTarget(), req => {
        const target = this.getCurrentTarget();
        
        return this.isDoTRefreshable("Rip", target) && 
               (!this.hasTalent("Primal Wrath") || this.getEnemiesInRange(8) == 1) && 
               (me.hasAura("Bloodtalons") || !this.hasTalent("Bloodtalons")) && 
               (me.hasAura("Tiger's Fury") || target.hasAura("Rip").remaining < spell.getCooldown("Tiger's Fury").timeleft) && 
               (target.hasAura("Rip").remaining < this.getFightRemains() || target.hasAura("Rip").remaining < 4 && me.hasAura("Ravage"));
      }),
      
      // Pool energy for Ferocious Bite
      new bt.Action(() => {
        if (!me.hasAura("Berserk") && me.powerByType(PowerType.Energy) < 50) {
          return bt.Status.Success; // Pool energy
        }
        return bt.Status.Failure;
      }),
      
      // Ferocious Bite with max energy outside Berserk
      spell.cast("Ferocious Bite", on => this.getCurrentTarget(), req => {
        return !me.hasAura("Berserk") && me.powerByType(PowerType.Energy) >= 50;
      }),
      
      // Ferocious Bite during Berserk (no energy requirement)
      spell.cast("Ferocious Bite", on => this.getCurrentTarget(), req => {
        return me.hasAura("Berserk");
      })
    );
  }

  // Builder actions for single target
  builder() {
    return new bt.Selector(
      // Prowl for Rake when Tiger's Fury is up
      spell.cast("Prowl", req => {
        return me.spellGCD == 0 && 
               me.powerByType(PowerType.Energy) >= 35 && 
               !me.hasAura("Sudden Ambush") && 
               (this.isDoTRefreshable("Rake", this.getCurrentTarget()) || this.getDoTPMultiplier("Rake") < 1.4) * 
               !(this.getVariable("need_bt") && me.hasAura("BT Rake")) && 
               me.hasAura("Tiger's Fury") && 
               !me.hasAura("Shadowmeld");
      }),
      
      // Shadowmeld for Rake when Tiger's Fury is up
      spell.cast("Shadowmeld", req => {
        return me.spellGCD == 0 && 
               me.powerByType(PowerType.Energy) >= 35 && 
               !me.hasAura("Sudden Ambush") && 
               (this.isDoTRefreshable("Rake", this.getCurrentTarget()) || this.getDoTPMultiplier("Rake") < 1.4) * 
               !(this.getVariable("need_bt") && me.hasAura("BT Rake")) && 
               me.hasAura("Tiger's Fury") && 
               !me.hasAura("Prowl");
      }),
      
      // Rake with upgrade or refresh
      spell.cast("Rake", on => this.getCurrentTarget(), req => {
        const target = this.getCurrentTarget();
        
        return ((this.isDoTRefreshable("Rake", target) && this.getDoTPersistentMultiplier() >= this.getDoTPMultiplier("Rake") || 
                target.hasAura("Rake").remaining < 3500) || 
                me.hasAura("Sudden Ambush") && this.getDoTPersistentMultiplier() > this.getDoTPMultiplier("Rake")) && 
               !(this.getVariable("need_bt") && me.hasAura("BT Rake")) && 
               (this.hasHeroTalent("Wildstalker") || !me.hasAura("Berserk"));
      }),
      
      // Shred with Sudden Ambush during Berserk
      spell.cast("Shred", on => this.getCurrentTarget(), req => {
        return me.hasAura("Sudden Ambush") && me.hasAura("Berserk");
      }),
      
      // Brutal Slash if charges are about to cap
      spell.cast("Brutal Slash", on => this.getCurrentTarget(), req => {
        return spell.getCooldown("Brutal Slash").fullRechargeTime < 4 && 
               !(this.getVariable("need_bt") && me.hasAura("BT Swipe"));
      }),
      
    //   // Moonfire if refreshable
    //   spell.cast("Moonfire", on => this.getCurrentTarget(), req => {
    //     return this.isDoTRefreshable("Moonfire", this.getCurrentTarget());
    //   }),
      
      // Thrash if refreshable and not talented into Thrashing Claws and not in Berserk
      spell.cast("Thrash", on => this.getCurrentTarget(), req => {
        return this.isDoTRefreshable("Thrash", this.getCurrentTarget()) && 
               !this.hasTalent("Thrashing Claws") && 
               !me.hasAura("Berserk");
      }),
      
      // Shred with Clearcasting
      spell.cast("Shred", on => this.getCurrentTarget(), req => {
        return me.hasAura("Clearcasting") && 
               !(this.getVariable("need_bt") && me.hasAura("BT Shred"));
      }),
      
      // Pool energy if we need to refresh dot soon
      new bt.Action(() => {
        if (this.getVariable("dot_refresh_soon") && 
            me.powerByType(PowerType.Energy) > 70 && 
            !this.getVariable("need_bt") && 
            !me.hasAura("Berserk") && 
            spell.getCooldown("Tiger's Fury").timeleft > 3) {
          return bt.Status.Success; // Pool energy
        }
        return bt.Status.Failure;
      }),
      
      // Brutal Slash
      spell.cast("Brutal Slash", on => this.getCurrentTarget(), req => {
        return !(this.getVariable("need_bt") && me.hasAura("BT Swipe"));
      }),
      
      // Shred default filler
      spell.cast("Shred", on => this.getCurrentTarget(), req => {
        return !(this.getVariable("need_bt") && me.hasAura("BT Shred"));
      }),
      
      // Thrash if refreshable and not talented into Thrashing Claws
      spell.cast("Thrash", on => this.getCurrentTarget(), req => {
        return this.isDoTRefreshable("Thrash", this.getCurrentTarget()) && 
               !this.hasTalent("Thrashing Claws");
      }),
      
      // Swipe for Bloodtalons
      spell.cast("Swipe", on => this.getCurrentTarget(), req => {
        return this.getVariable("need_bt") && !me.hasAura("BT Swipe");
      }),
      
      // Rake for Bloodtalons if it won't downgrade snapshot
      spell.cast("Rake", on => this.getCurrentTarget(), req => {
        return this.getVariable("need_bt") && 
               !me.hasAura("BT Rake") && 
               this.getDoTPersistentMultiplier() >= this.getDoTPMultiplier("Rake");
      }),
      
    //   // Moonfire for Bloodtalons
    //   spell.cast("Moonfire", on => this.getCurrentTarget(), req => {
    //     return this.getVariable("need_bt") && !me.hasAura("Moonfire");
    //   }),
      
      // Thrash for Bloodtalons
      spell.cast("Thrash", on => this.getCurrentTarget(), req => {
        return this.getVariable("need_bt") && !me.hasAura("BT Thrash");
      })
    );
  }

  // AoE builder actions
  aoeBuilder() {
    return new bt.Selector(
      // Set proccing_bt variable
      new bt.Action(() => {
        this.setVariable("proccing_bt", this.getVariable("need_bt"));
        return bt.Status.Failure;
      }),
      
      // Thrash highest priority to maintain in AoE
      spell.cast("Thrash", req => {
        return this.isDoTRefreshable("Thrash", this.getCurrentTarget()) && 
               !this.hasTalent("Thrashing Claws") && 
               !(this.getVariable("need_bt") && me.hasAura("BT Thrash"));
      }),
      
      // Brutal Slash for AoE and to avoid capping charges
      spell.cast("Brutal Slash", on => this.getBestAoETarget(), req => {
        return (spell.getCooldown("Brutal Slash").fullRechargeTime < 4 || 
                this.getFightRemains() < 4 || 
                (me.hasAura("Berserk") && this.getEnemiesInRange(8) >= 3 - (this.hasHeroTalent("Druid of the Claw") ? 1 : 0))) && 
               !(this.getVariable("need_bt") && me.hasAura("BT Swipe") && 
                 (me.hasAura("Berserk") == false || this.getEnemiesInRange(8) < 3 - (this.hasHeroTalent("Druid of the Claw") ? 1 : 0)));
      }),
      
      // Wild Slashes Swipe
      spell.cast("Swipe", req => {
        return this.hasTalent("Wild Slashes") && 
               (this.getFightRemains() < 4 || me.hasAura("Berserk") && this.getEnemiesInRange(8) >= 3 - (this.hasHeroTalent("Druid of the Claw") ? 1 : 0)) && 
               !(this.getVariable("need_bt") && me.hasAura("BT Swipe") && 
                 (me.hasAura("Berserk") == false || this.getEnemiesInRange(8) < 3 - (this.hasHeroTalent("Druid of the Claw") ? 1 : 0)));
      }),
      
      // Swipe in end of fight or at 5+ targets with Wild Slashes
      spell.cast("Swipe", req => {
        return this.getFightRemains() < 4 || 
               (this.hasTalent("Wild Slashes") && this.getEnemiesInRange(8) > 4 && 
                !(this.getVariable("need_bt") && me.hasAura("BT Swipe")));
      }),
      
      // Prowl for Rake
      spell.cast("Prowl", req => {
        return this.isDoTRefreshable("Rake", this.getCurrentTarget()) || 
               this.getDoTPMultiplier("Rake") < 1.4 && 
               !(this.getVariable("need_bt") && me.hasAura("BT Rake")) && 
               spell.isReady("Rake") && 
               me.spellGCD == 0 && 
               !me.hasAura("Sudden Ambush") && 
               !this.getVariable("cc_capped");
      }),
      
      // Shadowmeld for Rake
      spell.cast("Shadowmeld", req => {
        return this.isDoTRefreshable("Rake", this.getCurrentTarget()) || 
               this.getDoTPMultiplier("Rake") < 1.4 && 
               !(this.getVariable("need_bt") && me.hasAura("BT Rake")) && 
               spell.isReady("Rake") && 
               !me.hasAura("Sudden Ambush") && 
               !me.hasAura("Prowl") && 
               !this.getVariable("cc_capped");
      }),
      
      // Doubleclawed Rake
      spell.cast("Rake", on => this.getBestRakeTarget(), req => {
        return this.isDoTRefreshable("Rake", this.getBestRakeTarget()) && 
               this.hasTalent("Doubleclawed Rake") && 
               !(this.getVariable("need_bt") && me.hasAura("BT Rake")) && 
               !this.getVariable("cc_capped");
      }),
      
      // Swipe for 3+ targets with Wild Slashes
      spell.cast("Swipe", req => {
        return this.hasTalent("Wild Slashes") && 
               this.getEnemiesInRange(8) > 2 && 
               !(this.getVariable("need_bt") && me.hasAura("BT Swipe"));
      }),
      
      // Make sure at least one Rake is up with Wildstalker
      spell.cast("Rake", on => this.getNoRakeTarget(), req => {
        return this.getNoRakeTarget() && this.hasHeroTalent("Wildstalker");
      }),
      
    //   // Moonfire in AoE
    //   spell.cast("Moonfire", on => this.getBestMoonfireTarget(), req => {
    //     return this.isDoTRefreshable("Moonfire", this.getBestMoonfireTarget()) && 
    //            !(this.getVariable("need_bt") && me.hasAura("BT Moonfire")) && 
    //            !this.getVariable("cc_capped");
    //   }),
      
      // Rake in AoE
      spell.cast("Rake", on => this.getBestRakeTarget(), req => {
        return this.isDoTRefreshable("Rake", this.getBestRakeTarget()) && 
               !(this.getVariable("need_bt") && me.hasAura("BT Rake")) && 
               !this.getVariable("cc_capped");
      }),
      
      // Brutal Slash filler
      spell.cast("Brutal Slash", on => this.getBestAoETarget(), req => {
        return !(this.getVariable("need_bt") && me.hasAura("BT Swipe"));
      }),
      
      // Swipe filler
      spell.cast("Swipe", req => {
        return !(this.getVariable("need_bt") && me.hasAura("BT Swipe"));
      }),
      
      // Shred if not using easy swipe and not Sudden Ambush
      spell.cast("Shred", on => this.getCurrentTarget(), req => {
        return !me.hasAura("Sudden Ambush") && 
               !this.getVariable("easy_swipe") && 
               !(this.getVariable("need_bt") && me.hasAura("BT Shred"));
      }),
      
      // Thrash as filler
      spell.cast("Thrash", req => {
        return !this.hasTalent("Thrashing Claws") && 
               !(this.getVariable("need_bt") && me.hasAura("BT Thrash"));
      }),
      
      // Fallback Bloodtalons Rake with Sudden Ambush
      spell.cast("Rake", on => this.getBestRakeTarget(), req => {
        return this.hasTalent("Doubleclawed Rake") && 
               me.hasAura("Sudden Ambush") && 
               this.getVariable("need_bt") && 
               !me.hasAura("BT Rake");
      }),
      
    //   // Fallback Bloodtalons Moonfire
    //   spell.cast("Moonfire", on => this.getBestMoonfireTarget(), req => {
    //     return this.getVariable("need_bt") && !me.hasAura("BT Moonfire");
    //   }),
      
      // Fallback Bloodtalons Rake with Sudden Ambush
      spell.cast("Rake", on => this.getBestRakeTarget(), req => {
        return me.hasAura("Sudden Ambush") && 
               this.getVariable("need_bt") && 
               !me.hasAura("BT Rake");
      }),
      
      // Fallback Bloodtalons Shred
      spell.cast("Shred", on => this.getCurrentTarget(), req => {
        return this.getVariable("need_bt") && 
               !me.hasAura("BT Shred") && 
               !this.getVariable("easy_swipe");
      }),
      
      // Fallback Bloodtalons low multiplier Rake
      spell.cast("Rake", on => this.getBestRakeTarget(), req => {
        return this.getDoTPMultiplier("Rake") < 1.6 && 
               this.getVariable("need_bt") && 
               !me.hasAura("BT Rake");
      }),
      
      // Fallback Bloodtalons Thrash
      spell.cast("Thrash", req => {
        return this.getVariable("need_bt") && !me.hasAura("BT Shred");
      })
    );
  }

  // Helper methods
  hasTalent(talentName) {
    return me.hasAura(talentName);
  }
  
  hasHeroTalent(heroTalentTree) {
    if (heroTalentTree === "Druid of the Claw") {
      return me.hasAura("Ravage");
    } else if (heroTalentTree === "Wildstalker") {
      return me.hasAura("Thriving Growth");
    }
    return false;
  }
  
  getCurrentTarget() {
    const target = me.target;
    if (target && !target.isDead && me.canAttack(target)) {
      return target;
    }
    
    // Return the first valid combat target if player target is invalid
    for (const t of combat.targets) {
      if (t && !t.isDead && me.canAttack(t)) {
        return t;
      }
    }
    
    return null;
  }
  
  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }
  
  isDoTRefreshable(dotName, target) {
    if (!target) return false;
    
    const aura = target.getAura(dotName);
    if (!aura) return true;
    
    // Use pandemic timing (30% of max duration can be added)
    const pandemicThreshold = this.getDoTDuration(dotName) * 0.3;
    return aura.remaining <= pandemicThreshold;
  }
  
  getDoTRemainingTime(dotName) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    
    const aura = target.getAura(dotName);
    return aura ? aura.remaining : 0;
  }
  
  getDoTDuration(dotName) {
    // Default durations for common DoTs
    switch (dotName) {
      case "Rip":
        return this.getVariable("rip_duration") || (4 + (4 *  me.powerByType(PowerType.ComboPoints)));
      case "Rake":
        return 15 * (this.hasTalent("Circle of Life and Death") ? 0.8 : 1);
      case "Thrash":
        return 15 * (this.hasTalent("Circle of Life and Death") ? 0.8 : 1);
      case "Moonfire":
        return 16 * (this.hasTalent("Circle of Life and Death") ? 0.8 : 1);
      default:
        return 0;
    }
  }
  
  getDoTPMultiplier(dotName) {
    const target = this.getCurrentTarget();
    if (!target) return 1.0;
    
    const aura = target.getAura(dotName);
    return aura ? aura.pmultiplier || 1.0 : 1.0;
  }
  
  getDoTPersistentMultiplier() {
    // Calculate the current multiplier that would be applied to a new DoT
    let multiplier = 1.0;
    
    if (me.hasAura("Prowl") || me.hasAura("Shadowmeld") || me.hasAura("Sudden Ambush")) {
      multiplier *= 2.0; // Stealth bonus
    }
    
    if (me.hasAura("Tiger's Fury")) {
      multiplier *= 1.15; // Tiger's Fury bonus 
    }
    
    if (me.hasAura("Bloodtalons")) {
      multiplier *= 1.25; // Bloodtalons bonus
    }
    
    return multiplier;
  }
  
  getActiveBtTriggers() {
    let count = 0;
    if (me.hasAura("BT Rake")) count++;
    if (me.hasAura("BT Shred")) count++;
    if (me.hasAura("BT Thrash")) count++;
    if (me.hasAura("BT Moonfire")) count++;
    if (me.hasAura("BT Swipe")) count++;
    return count;
  }
  
  isPrimalWrathRefreshable() {
    const targets = this.getEnemiesInRange(8);
    let refreshable = false;
    
    // Logic to check if Primal Wrath is refreshable on any target
    // This is approximate since we don't have actual target iteration in the behavior API
    for (let i = 0; i < Math.min(targets, 5); i++) {
      if (Math.random() < 0.3) { // Simulating finding a target with refreshable Primal Wrath
        refreshable = true;
        break;
      }
    }
    
    return refreshable;
  }
  
  getPrimalWrathRemaining() {
    // Get approximate lowest remaining time on Primal Wrath across all targets
    return this.getDoTRemainingTime("Primal Wrath") || 0;
  }
  
  getBestRakeTarget() {
    // In real implementation this would find the best target to Rake
    // For now, just return current target
    return this.getCurrentTarget();
  }
  
  getBestMoonfireTarget() {
    // In real implementation this would find the best target to Moonfire
    // For now, just return current target
    return this.getCurrentTarget();
  }
  
  getBestAoETarget() {
    // In real implementation this would find the best target for AoE abilities
    // For now, just return current target
    return this.getCurrentTarget();
  }
  
  getNoRakeTarget() {
    // Find a target without Rake
    const target = this.getCurrentTarget();
    if (target && !target.hasAura("Rake")) {
      return target;
    }
    return null;
  }
  
  getAdaptiveSwarmTarget() {
    // Find best target for Adaptive Swarm (single target)
    return this.getCurrentTarget();
  }
  
  getAdaptiveSwarmAoETarget() {
    // Find best target for Adaptive Swarm in AoE
    return this.getCurrentTarget();
  }
  
  hasDebuff(debuffName) {
    const target = this.getCurrentTarget();
    return target && target.hasAura(debuffName);
  }
  
  isBossTarget() {
    const target = this.getCurrentTarget();
    if (!target) return false;
    
    // Check for boss classification or other indicators
    return target.classification === 3; // Boss classification
  }
  
  getFightRemains() {
    // Estimate remaining fight duration
    return this.isBossTarget() ? 300 : this.getTargetTimeToDie();
  }
  
  getTargetTimeToDie() {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    
    // If target has timeToDeath method, use it
    if (typeof target.timeToDeath === 'function') {
      const ttd = target.timeToDeath();
      return ttd !== undefined ? ttd : 15;
    }
    
    // Fallback estimation based on health percentage
    return Math.max(5, target.pctHealth * 0.3);
  }
  
  // Trinket helper methods
  hasTrinketDamage(slot) {
    // Implement logic to check if trinket has use damage
    return true;
  }
  
  hasTrinketBuffs(slot) {
    // Implement logic to check if trinket has use buffs
    return true;
  }
  
  hasTrinketCooldown(slot) {
    // Implement logic to check if trinket has cooldown
    return true;
  }
  
  getTrinketPriority() {
    // Implement logic to determine which trinket has priority
    return 1;
  }
  
  getTrinketDuration(slot) {
    // Implement logic to get trinket proc duration
    return 15;
  }
}