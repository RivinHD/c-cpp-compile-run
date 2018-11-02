"use strict";

import { VSCodeUI } from "./VSCodeUI";
import { Constants } from "./Constants";
import { window, ConfigurationTarget, workspace, commands } from "vscode";
import { commandExists } from './CommandExists';
import { existsSync } from "fs";
import { exec, spawn } from "child_process";
import { File } from './File';
import { Settings } from "./Settings";

export class CompileRun {
    private outputChannel: VSCodeUI.CompileRunOutputChannel;
    private terminal: VSCodeUI.CompileRunTerminal;
    readonly Action: Constants.Action;

    constructor() {
        this.outputChannel = new VSCodeUI.CompileRunOutputChannel();
        this.terminal = VSCodeUI.compileRunTerminal;
    }

    private async compile(file: File, doRun: boolean = false, withFlags: boolean = false) {
        if (Settings.saveBeforeCompile) {
            await window.activeTextEditor.document.save();
        }

        let exec;

        let compilerArgs = [file.$name, '-o', file.$executable];

        let compilerSetting: { path: string, flags: string };
        let compilerSettingKey: { path: string, flags: string };

        switch (file.$extension) {
            case 'cpp': {
                compilerSetting = {
                    path: Settings.cppCompiler(),
                    flags: Settings.cppFlags()
                };

                compilerSettingKey = {
                    path: Settings.key.cppCompiler,
                    flags: Settings.key.cppFlags
                };
                break;
            }
            case 'c': {
                compilerSetting = {
                    path: Settings.cCompiler(),
                    flags: Settings.cFlags()
                };
                compilerSettingKey = {
                    path: Settings.key.cCompiler,
                    flags: Settings.key.cFlags
                };
                break;
            }
            default: {
                return;
            }
        }

        if (!commandExists(compilerSetting.path)) {
            const CHANGE_PATH: string = "Change path";
            const choiceForDetails: string = await window.showErrorMessage("Compiler not found, try to change path in settings!", CHANGE_PATH);
            if (choiceForDetails === CHANGE_PATH) {
                let path = await this.promptForPath();
                await workspace.getConfiguration("c-cpp-compile-run", null).update(compilerSettingKey.path, path, ConfigurationTarget.Global);
                this.compile(file, doRun, withFlags);
                return;
            }
            return;
        }
        if (withFlags) {
            let flagsStr = await this.promptForFlags(compilerSetting.flags);
            if (flagsStr === undefined) { // cancel.
                return;
            }
            compilerArgs = compilerArgs.concat(flagsStr.split(" "));
        } else {
            compilerArgs = compilerArgs.concat(compilerSetting.flags.split(" "));
        }

        exec = spawn(compilerSetting.path, compilerArgs, { cwd: file.$directory });

        exec.stdout.on('data', (data: any) => {
            this.outputChannel.appendLine(data, file.$name);
            this.outputChannel.show();
        });

        exec.stderr.on('data', (data: any) => {
            this.outputChannel.appendLine(data, file.$name);
            this.outputChannel.show();
        });

        exec.on('close', (data: any) => {
            if (data === 0) {
                // Compiled successfully let's tell the user & execute
                window.showInformationMessage("Compiled successfuly!");
                if (doRun) {
                    this.run(file);
                }
            } else {
                // Error compiling
                window.showErrorMessage("Error compiling!");
            }
        });
    }

    private async run(file: File, inputArgs: boolean = false) {
        if (!existsSync(file.$path)) {
            window.showErrorMessage(`"${file.$path}" doesn't exists!`);
            return;
        }

        let args = Settings.runArgs();
        if (inputArgs) {
            let argsStr = await this.promptForRunArgs(Settings.runArgs());
            if (argsStr === undefined) { // cancel.
                return;
            }
            args = argsStr;
        }

        if (Settings.runInExternalTerminal()) {
            if (!this.runExternal(file, args)) {
                commands.executeCommand("workbench.action.terminal.clear");
                this.terminal.runExecutable(file.$executable, args, { cwd: file.$directory });
            }
        } else {
            commands.executeCommand("workbench.action.terminal.clear");
            this.terminal.runExecutable(file.$executable, args, { cwd: file.$directory });
        }
    }

    public async compileRun(action: Constants.Action) {
        if (!window.activeTextEditor.document) {
            return;
        }

        let file = new File(window.activeTextEditor.document);

        switch (action) {
            case Constants.Action.Compile:
                this.compile(file);
                break;
            case Constants.Action.Run:
                this.run(file);
                break;
            case Constants.Action.CompileRun:
                this.compile(file, true);
                break;
            case Constants.Action.CompileWithFlags:
                this.compile(file, false, true);
                break;
            case Constants.Action.RunWithArguments:
                this.run(file, true);
                break;
            default: return;
        }
    }

    private async promptForFlags(defaultFlags: string): Promise<string | undefined> {
        try {
            return await window.showInputBox({
                prompt: 'Flags',
                placeHolder: '-Wall -Wextra',
                value: defaultFlags
            });
        } catch (e) {
            return null;
        }
    }

    private async promptForRunArgs(defaultArgs: string): Promise<string | undefined> {
        try {
            return await window.showInputBox({
                prompt: 'Arguments',
                value: defaultArgs
            });
        } catch (e) {
            return null;
        }
    }

    private async promptForPath(): Promise<string | undefined> {
        try {
            return await window.showInputBox({
                prompt: 'Path',
                placeHolder: '/usr/bin/gcc'
            });
        } catch (e) {
            return null;
        }
    }

    private runExternal(file: File, args: string): boolean {
        switch (process.platform) {
            case 'win32':
                exec(`start cmd /c "${file.$executable} ${args} & echo. & pause"`, { cwd: file.$directory });
                return true;
            case 'linux':
                let terminal: string = workspace.getConfiguration().get('terminal.external.linuxExec');
                if (!commandExists(terminal)) {
                    window.showErrorMessage(`${terminal} not found! Try to enter a valid terminal in 'terminal.external.linuxExec' settings! (gnome-terminal, xterm, konsole)`);
                    window.showInformationMessage('Running on vscode terminal');
                    return false;
                }

                switch (terminal) {
                    case 'xterm':
                        exec(`${terminal} -T ${file.$title} -e './${file.$executable} ${args}; echo; read -n1 -p "Press any key to continue..."'`, { cwd: file.$directory });
                        return true;
                    case 'gnome-terminal':
                    case 'tilix':
                    case 'mate-terminal':
                        exec(`${terminal} -t ${file.$title} -x bash -c './${file.$executable} ${args}; echo; read -n1 -p "Press any key to continue..."'`, { cwd: file.$directory });
                        return true;
                    case 'xfce4-terminal':
                        exec(`${terminal} --title ${file.$title} -x bash -c './${file.$executable} ${args}; read -n1 -p "Press any key to continue..."'`, { cwd: file.$directory });
                        return true;
                    case 'konsole':
                        exec(`${terminal} -p tabtitle='${file.$title}' --noclose -e bash -c './${file.$executable} ${args}'`, { cwd: file.$directory });
                        return true;
                    case 'io.elementary.terminal':
                        exec(`${terminal} -e './${file.$executable} ${args}'`, { cwd: file.$directory });
                        return true;
                    default:
                        window.showErrorMessage(`${terminal} isn't supported! Try to enter a supported terminal in 'terminal.external.linuxExec' settings! (gnome-terminal, xterm, konsole)`);
                        window.showInformationMessage('Running on vscode terminal');
                        return false;
                }
            case 'darwin':
                exec(`osascript - e 'tell application "Terminal" to do script "./${file.$executable} && read -n1 -p "Press any key to continue...""'`, { cwd: file.$directory });
                return true;
        }
        return false;
    }
}