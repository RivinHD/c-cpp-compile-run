import { exec } from "child_process";
import { existsSync } from "fs";
import { Configuration } from "./configuration";
import { ShellType } from "./enums/shell-type";
import { File } from "./models/file";
import { Notification } from "./notification";
import { terminal } from "./terminal";
import { promptRunArguments } from "./utils/prompt-utils";
import { currentShell, getPath, getRunPrefix, parseShell } from "./utils/shell-utils";
import path = require("path");
import { basename } from "path";
import { externalTerminal } from "./external-terminal";
import isWsl = require("is-wsl");

export class Runner {
    private file: File;
    private shouldAskForArgs: boolean;

    constructor(file: File, shouldAskForArgs = false) {
        this.file = file;
        this.shouldAskForArgs = shouldAskForArgs;
    }

    async run(shouldRunInExternalTerminal = false): Promise<void> {
        if (!existsSync(this.file.path)) {
            Notification.showErrorMessage(`"${this.file.path}" doesn't exists!`);

            return;
        }

        let args = Configuration.runArgs();
        if (this.shouldAskForArgs) {
            args = await promptRunArguments(args);
        }

        let outputLocation = Configuration.outputLocation();
        if (!outputLocation) {
            outputLocation = path.join(this.file.directory, "output");
        }

        let customPrefix = Configuration.customRunPrefix();

        const shell = this.getShell(shouldRunInExternalTerminal);

        const parsedExecutable = await getPath(this.file.executable, shell);

        const runCommand = this.getRunCommand(parsedExecutable, args, customPrefix, shell);

        if (shouldRunInExternalTerminal === true && isWsl === true) {
            Notification.showWarningMessage("Wsl detected, running in vscode terminal!");

            shouldRunInExternalTerminal = false;
        }

        if (shouldRunInExternalTerminal) {
            await externalTerminal.runInExternalTerminal(runCommand, outputLocation, shell);
        }
        else {
            await terminal.runInTerminal(runCommand, { name: "C/C++ Compile Run", cwd: outputLocation });
        }
    }

    getRunCommand(executable: string, args: string, customPrefix: string, shell: ShellType) {
        const prefix = getRunPrefix(shell);
        const showExecutionTime = Configuration.showExecutionTime();

        let command = `${prefix}${executable} ${args}`.trim();
        if (customPrefix) {
            command = `${customPrefix} ${command}`;
        }

        if (!showExecutionTime) {
            return command;
        }

        if (process.platform === "linux" || process.platform === "darwin") {
            return `TIMEFMT='%J (elapsed time: %E)';time ${command}`;
        }

        if (process.platform === "win32" && shell === ShellType.powerShell) {
            return `Measure-Command {${command}} | select @{n='Execution time:';e={$_.Minutes,'Minutes',$_.Seconds,'Seconds',$_.Milliseconds,'Milliseconds' -join ' '}}`;
        }

        return command;
    }

    getShell(runInExternalTerminal: boolean): ShellType {
        if (runInExternalTerminal) {
            switch (process.platform) {
                case "win32":
                    const terminal = basename(Configuration.winTerminal());
                    const shell = parseShell(terminal);
                    return shell === ShellType.powerShell ? ShellType.powerShell : ShellType.cmd;
                default:
                    return ShellType.others;
            }
        } else {
            return currentShell();
        }
    }
}


