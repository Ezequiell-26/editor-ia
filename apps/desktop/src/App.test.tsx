import {fireEvent,render,screen} from "@testing-library/react";
import {describe,expect,it} from "vitest";
import App from "./App";
describe("Editor IA desktop shell",()=>{
 it("renders project home and primary navigation",()=>{render(<App/>);expect(screen.getByRole("heading",{name:/De una idea a un video listo/i})).toBeTruthy();expect(screen.getByRole("navigation",{name:"Navegación principal"})).toBeTruthy();for(const name of ["Proyectos","Editor","Biblioteca","Configuración"])expect(screen.getByRole("button",{name})).toBeTruthy();});
 it("navigates to an honest empty timeline state",()=>{render(<App/>);fireEvent.click(screen.getByRole("button",{name:"Editor"}));expect(screen.getByRole("heading",{name:"Editor de contenido"})).toBeTruthy();expect(screen.getByText(/Importá medios para empezar a editar/i)).toBeTruthy();expect(screen.getByText(/Edición asistida por IA: pendiente de integración/i)).toBeTruthy();expect(screen.getByRole("button",{name:"Exportar"})).toBeDisabled();});
 it("returns to the project home",()=>{render(<App/>);fireEvent.click(screen.getByRole("button",{name:"Editor"}));fireEvent.click(screen.getByRole("button",{name:"Proyectos"}));expect(screen.getByRole("heading",{name:/De una idea a un video listo/i})).toBeTruthy();});
});