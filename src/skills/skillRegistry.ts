import { Skill } from "../types";

// Import your skill files here
import { ChatSkill } from "./actions";
import { AttackSkill } from "./actions";

export class SkillRegistry {
    private skills: Map<string, Skill> = new Map();

    constructor() {
        // Register default skills
        this.registerSkill(ChatSkill);
        this.registerSkill(AttackSkill);
    }

    registerSkill(skill: Skill) {
        this.skills.set(skill.name, skill);
    }

    getSkill(name: string): Skill | undefined {
        return this.skills.get(name);
    }

    // Returns the tools formatted for the Ollama API
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