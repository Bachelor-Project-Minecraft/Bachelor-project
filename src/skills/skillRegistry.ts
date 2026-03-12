import { Skill } from "../types";
import { AttackSkill, ChatSkill, createUseActionSkill } from "./actions";
import { GeneratedActionService } from "./generatedActionService";

export class SkillRegistry {
    private skills: Map<string, Skill> = new Map();

    constructor(actionService?: GeneratedActionService) {
        this.registerSkill(ChatSkill);
        this.registerSkill(AttackSkill);

        if (actionService) {
            this.registerSkill(createUseActionSkill(actionService));
        }
    }

    registerSkill(skill: Skill) {
        this.skills.set(skill.name, skill);
    }

    getSkill(name: string): Skill | undefined {
        return this.skills.get(name);
    }

    getTools() {
        return Array.from(this.skills.values()).map(skill => ({
            type: 'function',
            function: {
                name: skill.name,
                description: skill.description,
                parameters: skill.parameters
            }
        }));
    }
}