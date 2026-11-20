import axios from "axios";
import { useState } from "react";
import { authService } from "../services/api/authService";
import { usersService } from "../services/api/usersService";
import {
  removeRememberedSession,
  saveRememberedSession,
} from "../services/authSessionStorage";
import { useAuthStore } from "../store";
import { parseApiError } from "../utils/apiErrors";

export function useAuth() {
  const { setAuth, setAccessToken, clearAuth, user, isAuthenticated, hasPermission, updateUser } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearError = () => {
    setError(null);
    setFieldErrors({});
  };

  async function login(username: string, password: string, rememberMe = false) {
    setIsLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await authService.login(username, password);
      const accountName = response.username || username;
      // Se configura el token para consultar /auth/me sin autenticar la UI
      // antes de conocer el rol: los guards redirigían mientras role=unknown.
      setAccessToken(response.token, response.tokenType || 'Bearer');
      try {
        const profile = await authService.getCurrentUser(accountName);
        setAuth(profile, response.token, response.tokenType || "Bearer");
      } catch (profileError) {
        clearAuth();
        if (axios.isAxiosError(profileError) && !profileError.response) {
          throw new Error('Iniciaste sesión, pero no se pudo conectar con /auth/me para cargar tu rol.');
        }
        const status = axios.isAxiosError(profileError) ? profileError.response?.status : undefined;
        throw new Error(`Iniciaste sesión, pero no se pudo cargar tu perfil (${status ?? 'respuesta inválida'}). Revisá /auth/me en el backend.`);
      }
      try {
        if (rememberMe) {
          await saveRememberedSession({
            username: accountName,
            token: response.token,
            tokenType: response.tokenType || "Bearer",
          });
        } else {
          await removeRememberedSession();
        }
      } catch (storageError) {
        // A storage issue must not turn a successful server login into a failed login.
        console.warn("No se pudo actualizar la sesión recordada", storageError);
      }
    } catch (e: any) {
      const parsed = parseApiError(e, "");
      setFieldErrors(parsed.fields);
      const status = e?.response?.status;
      if (axios.isAxiosError(e) && !e.response) {
        setError("No se pudo conectar con el servidor");
      } else if (status === 401) {
        const backendMessage = e?.response?.data?.message;
        if (
          typeof backendMessage === "string" &&
          /authentication is required or invalid/i.test(backendMessage)
        ) {
          setError("Contraseña incorrecta.");
        } else {
          setError(
            typeof backendMessage === "string"
              ? backendMessage
              : "Email o contraseña incorrectos",
          );
        }
      } else if (status === 403) {
        setError("El usuario no tiene permiso para iniciar sesión");
      } else {
        setError(
          e?.response?.data?.message || e.message || "Error al iniciar sesión",
        );
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function logout() {
    try {
      if (isAuthenticated) await authService.logout();
    } catch (logoutError) {
      // Always clear the local session, even if the server cannot be reached.
      console.warn("No se pudo invalidar la sesión.", logoutError);
    } finally {
      clearAuth();
    }
    try {
      await removeRememberedSession();
    } catch (storageError) {
      console.warn("No se pudo borrar la sesión guardada", storageError);
    }
  }

  async function editProfile(changes: {
    fullName?: string;
    username?: string;
  }) {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const fullName = changes.fullName?.trim() || user.fullName;
      const email = changes.username?.trim() || user.username;
      const roleId = Number(user.roleId);
      const updated = await usersService.updateUser(user.id, {
        fullName,
        email,
        ...(Number.isInteger(roleId) && roleId > 0 ? { roleId } : {}),
      });
      const userChanges = {
        fullName: updated.fullName || fullName,
        username: updated.email || email,
        ...(updated.roleId ? { roleId: updated.roleId } : {}),
        ...(updated.roleName ? { roleName: updated.roleName } : {}),
      };
      updateUser(userChanges);
      return userChanges;
    } catch (e: any) {
      const parsed = parseApiError(e, "Error al actualizar el perfil.");
      setFieldErrors(parsed.fields);
      if (!Object.keys(parsed.fields).length) setError(parsed.message);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }

  return {
    login,
    logout,
    editProfile,
    user,
    isAuthenticated,
    isLoading,
    error,
    fieldErrors,
    clearError,
    hasPermission,
  };
}
