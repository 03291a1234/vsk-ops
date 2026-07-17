using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using VskOps.Api.Auth;
using VskOps.Core.Domain;
using VskOps.Infrastructure.Repositories;

namespace VskOps.Api.Controllers;

public record RegisterRequest(string Name, string Email, string Password, string Role, int? DriverId);
public record ResetPasswordRequest(string NewPassword);
public record LoginRequest(string Email, string Password);
public record LoginResponse(string Token, string Name, string Role, int? DriverId);

[ApiController]
[Route("api/auth")]
public class AuthController(
    UserRepository users,
    IPasswordHasher<User> hasher,
    JwtTokenService tokens) : ControllerBase
{
    private static readonly string[] ValidRoles = [Roles.Owner, Roles.Dispatch, Roles.Accountant, Roles.Driver];

    /// <summary>Owner resets any account's password (there is no self-service flow yet).</summary>
    [HttpPut("users/{id:int}/password")]
    [Authorize(Roles = Roles.Owner)]
    public async Task<ActionResult> ResetPassword(int id, ResetPasswordRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.NewPassword)) return BadRequest("Password is required.");
        var user = await users.GetById(id);
        if (user is null) return NotFound();
        await users.UpdatePasswordHash(id, hasher.HashPassword(user, req.NewPassword));
        return NoContent();
    }

    /// <summary>All accounts — the Owner's Team page.</summary>
    [HttpGet("users")]
    [Authorize(Roles = Roles.Owner)]
    public async Task<ActionResult> GetUsers()
    {
        var all = await users.GetAll();
        return Ok(all.Select(u => new { u.Id, u.Name, u.Email, u.Role, u.DriverId, u.CreatedAt }));
    }

    /// <summary>
    /// The very first user can self-register (bootstrap) and is forced to Owner;
    /// after that, only an Owner can create accounts.
    /// </summary>
    [HttpPost("register")]
    [AllowAnonymous]
    public async Task<ActionResult> Register(RegisterRequest req)
    {
        if (!ValidRoles.Contains(req.Role)) return BadRequest($"Role must be one of: {string.Join(", ", ValidRoles)}");
        if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest("Email and password are required.");

        var isBootstrap = await users.Count() == 0;
        if (!isBootstrap && !User.IsInRole(Roles.Owner))
            return Forbid();
        if (await users.GetByEmail(req.Email) is not null)
            return Conflict("A user with this email already exists.");

        var user = new User
        {
            Name = req.Name,
            Email = req.Email,
            Role = isBootstrap ? Roles.Owner : req.Role,
            DriverId = req.Role == Roles.Driver ? req.DriverId : null,
        };
        user.PasswordHash = hasher.HashPassword(user, req.Password);
        var id = await users.Insert(user);
        return CreatedAtAction(nameof(Register), new { id }, new { id, user.Role });
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest req)
    {
        var user = await users.GetByEmail(req.Email);
        if (user is null) return Unauthorized();
        var result = hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password);
        if (result == PasswordVerificationResult.Failed) return Unauthorized();
        return new LoginResponse(tokens.CreateToken(user), user.Name, user.Role, user.DriverId);
    }
}
